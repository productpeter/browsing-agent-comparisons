"use client";

import {
  formatFirecrawlCreditsLive,
  TABSTACK_CREDITS_DISPLAY_PLACEHOLDER,
} from "@/lib/credit-comparison";
import {
  MODE_ENDPOINT_PREVIEW,
  type CompareMode,
} from "@/lib/compare-modes";
import { BenchmarkPdfSnapshot } from "@/components/benchmark-pdf-snapshot";
import { captureHtmlToPdfSnapshot } from "@/lib/capture-snapshot-pdf";
import type { ReportComparePayload } from "@/lib/comparison-report-pdf";
import { useEffect, useMemo, useRef, useState } from "react";

/** Matches server `TABSTACK_AUTOMATE_TIMEOUT_MS` default (60s); set NEXT_PUBLIC_ in .env to align UI countdown. */
function publicAutomateTimeoutMs(): number {
  const raw = process.env.NEXT_PUBLIC_TABSTACK_AUTOMATE_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 60_000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 60_000;
  return n;
}

function formatElapsedShort(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m <= 0) return `${s}s`;
  return `${m}:${rs.toString().padStart(2, "0")}`;
}

function nullRunStarts(): Record<CompareMode, number | null> {
  return {
    markdown: null,
    generate: null,
    automate: null,
    research: null,
    search: null,
    crawl: null,
    map: null,
  };
}

type BenchmarkRow = {
  durationMs: number;
  ok: boolean;
  status: number;
  contentLength: number;
  preview: string;
  endpoint: string;
  estimatedActions?: number;
  estimatedUsd?: number;
  creditsUsed?: number | null;
  creditsEstimated?: number;
  creditsMeasured?: boolean;
  error?: string;
  notes?: string;
};

/** Short name per mode (pairing is shown separately). */
const MODE_LABELS: Record<CompareMode, string> = {
  markdown: "Scrape",
  generate: "Extract",
  automate: "Automate",
  research: "Deep research",
  search: "Search",
  crawl: "Crawl",
  map: "Map",
};

/** Which providers this mode calls in this app. */
const MODE_PAIRING: Record<
  CompareMode,
  "both" | "firecrawl" | "tabstack"
> = {
  markdown: "both",
  generate: "both",
  automate: "tabstack",
  research: "both",
  search: "firecrawl",
  crawl: "firecrawl",
  map: "firecrawl",
};

function modePairingHint(mode: CompareMode): string {
  switch (MODE_PAIRING[mode]) {
    case "both":
      return "Tabstack + Firecrawl";
    case "firecrawl":
      return "Firecrawl only";
    case "tabstack":
      return "Tabstack only";
  }
}

/** Selected mode tab — `ctrl-primary` in globals.css (accent tint; avoids black zinc fills). */
const CTRL_FILLED = "ctrl-primary";

/** Submit Run — `btn-run` in globals.css (border + card bg). */
const RUN_BTN = "btn-run";

/** What each mode’s `preview` fields contain — drives labels + blurbs in the UI. */
const OUTPUT_PREVIEW_COPY: Record<
  CompareMode,
  {
    title: string;
    description: string;
    tabstackColumn?: string;
    firecrawlColumn?: string;
  }
> = {
  markdown: {
    title: "Markdown output",
    description:
      "Clean markdown from Tabstack’s page extract vs Firecrawl’s scrape of the same URL.",
    tabstackColumn: "Tabstack · extract/markdown",
    firecrawlColumn: "Firecrawl · scrape → markdown",
  },
  generate: {
    title: "Generated JSON",
    description:
      "Structured JSON from the shared schema + instructions (generate vs LLM extract).",
    tabstackColumn: "Tabstack · generate/json",
    firecrawlColumn: "Firecrawl · extract (LLM)",
  },
  automate: {
    title: "Automation output",
    description:
      "Tabstack language agent only — SSE stream from POST /v1/automate for your natural-language task on the URL.",
    tabstackColumn: "Tabstack · automate (SSE)",
  },
  research: {
    title: "Research output",
    description:
      "Tabstack: raw SSE from /research. Firecrawl: synthesized text from deep-research (different products).",
    tabstackColumn: "Tabstack · research (SSE)",
    firecrawlColumn: "Firecrawl · deep-research",
  },
  search: {
    title: "Search results",
    description:
      "Firecrawl POST /v2/search only — no Tabstack equivalent in this app.",
    firecrawlColumn: "Firecrawl · search",
  },
  crawl: {
    title: "Crawl output",
    description:
      "Firecrawl POST /v2/crawl + GET poll — no Tabstack multi-page crawl here.",
    firecrawlColumn: "Firecrawl · crawl + poll",
  },
  map: {
    title: "URL map",
    description:
      "Firecrawl POST /v2/map — list URLs on a site; no Tabstack equivalent here.",
    firecrawlColumn: "Firecrawl · map",
  },
};

/** ISO timestamps formatted identically on server & client (avoids hydration mismatch from `toLocaleString`). */
function formatComparedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export default function Home() {
  const [mode, setMode] = useState<CompareMode>("markdown");
  const [url, setUrl] = useState("https://techcrunch.com/");
  const [task, setTask] = useState(
    "From the homepage, list the exact titles of the three most prominent article headlines visible near the top."
  );
  const [query, setQuery] = useState(
    "What are the most significant startup funding or venture deals in tech recently, and which companies or investors does reporting highlight?"
  );
  const [instructions, setInstructions] = useState(
    "Summarize TechCrunch’s homepage: main themes and the most prominent headlines in one clear paragraph."
  );
  const [loadingByMode, setLoadingByMode] = useState<
    Record<CompareMode, boolean>
  >({
    markdown: false,
    generate: false,
    automate: false,
    research: false,
    search: false,
    crawl: false,
    map: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [resultsByMode, setResultsByMode] = useState<
    Record<CompareMode, ReportComparePayload | null>
  >({
    markdown: null,
    generate: null,
    automate: null,
    research: null,
    search: null,
    crawl: null,
    map: null,
  });

  /** Last successful run for the active mode tab (each tab keeps its own). */
  const data = resultsByMode[mode];

  /** Avoid hydration mismatch: saved-result dots aren’t in the SSR HTML. */
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => setClientReady(true), []);

  const automateCapMs = useMemo(() => publicAutomateTimeoutMs(), []);
  const runStartedAtByModeRef = useRef<Record<CompareMode, number | null>>(
    nullRunStarts()
  );
  const [runTick, setRunTick] = useState(0);
  const loading = loadingByMode[mode];

  const anyLoading = useMemo(
    () =>
      (Object.keys(loadingByMode) as CompareMode[]).some(
        (m) => loadingByMode[m]
      ),
    [loadingByMode]
  );

  const hasSavedResults = useMemo(
    () =>
      (Object.keys(resultsByMode) as CompareMode[]).some(
        (m) => resultsByMode[m] != null
      ),
    [resultsByMode]
  );

  const [exportingPdf, setExportingPdf] = useState(false);
  const pdfSnapshotRef = useRef<HTMLDivElement>(null);

  async function handleExportPdf() {
    const el = pdfSnapshotRef.current;
    if (!el || !hasSavedResults) return;
    setExportingPdf(true);
    try {
      const safeDate = new Date().toISOString().slice(0, 10);
      await captureHtmlToPdfSnapshot(
        el,
        `tabstack-firecrawl-benchmark-${safeDate}.pdf`
      );
    } finally {
      setExportingPdf(false);
    }
  }

  useEffect(() => {
    if (!anyLoading) return;
    const id = setInterval(() => setRunTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [anyLoading]);

  const elapsedWhileRunningMs = useMemo(() => {
    if (!loadingByMode[mode]) return 0;
    const start = runStartedAtByModeRef.current[mode];
    if (start == null) return 0;
    return Date.now() - start;
  }, [mode, loadingByMode, runTick]);

  const maxMs = useMemo(() => {
    if (!data) return 1;
    const t = data.tabstack?.durationMs ?? 0;
    const f = data.firecrawl?.durationMs ?? 0;
    return Math.max(t, f, 1);
  }, [data]);

  async function runCompare(e: React.FormEvent) {
    e.preventDefault();
    const runMode = mode;
    runStartedAtByModeRef.current[runMode] = Date.now();
    setRunTick((n) => n + 1);
    setLoadingByMode((prev) => ({ ...prev, [runMode]: true }));
    setError(null);
    try {
      const body: Record<string, unknown> = { mode: runMode };
      if (runMode !== "search" && url.trim()) body.url = url.trim();
      if (runMode === "automate") body.task = task;
      if (runMode === "research" || runMode === "search") body.query = query;
      if (runMode === "generate") body.instructions = instructions;

      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `Request failed (${res.status})`);
        return;
      }
      const payload = json as ReportComparePayload;
      const resultMode = payload.mode;
      setResultsByMode((prev) => ({
        ...prev,
        [resultMode]: payload,
      }));
    } catch {
      setError("Network error — is the dev server running?");
    } finally {
      runStartedAtByModeRef.current[runMode] = null;
      setLoadingByMode((prev) => ({ ...prev, [runMode]: false }));
    }
  }

  const modeEndpoints = MODE_ENDPOINT_PREVIEW[mode];

  return (
    <div className="min-h-full bg-[var(--surface)] text-[var(--ink)]">
      {/*
        Off-screen DOM for html2canvas — must stay painted (no opacity:0) so
        fonts and layout rasterize like the live UI.
      */}
      <div
        className="pointer-events-none fixed top-0 left-0 z-[-1] overflow-hidden"
        style={{ transform: "translateX(-10000px)" }}
        aria-hidden
      >
        <BenchmarkPdfSnapshot
          ref={pdfSnapshotRef}
          resultsByMode={resultsByMode}
          modeLabels={MODE_LABELS}
        />
      </div>
      <div className="mx-auto max-w-4xl px-6 py-14">
        <header className="mb-10 border-b border-[var(--line)] pb-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Benchmark
          </p>
          <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight md:text-4xl">
            Tabstack vs Firecrawl
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
            Paired runs: scrape, structured extract, and deep research. Automate
            is Tabstack-only (no comparable Firecrawl agent here). Firecrawl-only:
            search, crawl, and map—those tabs show a single provider column.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={!hasSavedResults || exportingPdf}
              title={
                hasSavedResults
                  ? "Download a styled snapshot of every saved mode as a multi-page PDF"
                  : "Run at least one benchmark mode first"
              }
              className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 font-mono text-sm font-medium outline-none transition hover:border-[var(--accent)]/45 hover:bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card))] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {exportingPdf ? "Building PDF…" : "Download PDF report"}
            </button>
            <span className="max-w-md text-xs leading-relaxed text-[var(--muted)]">
              Renders the same benchmark layout as the site (cards, bars,
              previews) to a multi-page PDF. Very long previews are capped for
              the export.
            </span>
          </div>
        </header>

        <div className="mb-8 flex flex-wrap gap-2">
          {(Object.keys(MODE_LABELS) as CompareMode[]).map((m) => {
            const selected = mode === m;
            return (
              <button
                key={m}
                type="button"
                title={`${MODE_LABELS[m]} — ${modePairingHint(m)}`}
                onClick={() => {
                  if (m !== mode) {
                    setError(null);
                  }
                  setMode(m);
                }}
                className={`inline-flex min-w-[8.5rem] flex-col gap-1 rounded-lg px-3 py-2 text-left font-mono text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] ${
                  selected
                    ? `border-2 border-[var(--accent)] ${CTRL_FILLED}`
                    : "border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--accent)]/40"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">
                    {MODE_LABELS[m]}
                  </span>
                  {clientReady ? (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        resultsByMode[m]
                          ? "bg-emerald-500"
                          : "invisible bg-transparent"
                      }`}
                      aria-hidden
                      title={
                        resultsByMode[m] ? "Saved result for this mode" : ""
                      }
                    />
                  ) : null}
                </span>
                <span className="text-[11px] leading-snug text-[var(--muted)]">
                  {modePairingHint(m)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mb-6 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
            API endpoints ({MODE_LABELS[mode]})
          </p>
          <ul className="mt-2 space-y-1.5">
            {modeEndpoints.tabstack ? (
              <li className="break-all font-mono text-[11px] leading-snug text-[var(--tabstack)]">
                <span className="text-[var(--muted)]">Tabstack · </span>
                {modeEndpoints.tabstack}
              </li>
            ) : null}
            {modeEndpoints.firecrawl ? (
              <li className="break-all font-mono text-[11px] leading-snug text-[var(--firecrawl)]">
                <span className="text-[var(--muted)]">Firecrawl · </span>
                {modeEndpoints.firecrawl}
              </li>
            ) : null}
          </ul>
        </div>

        <form onSubmit={runCompare} className="space-y-4">
          {(mode === "markdown" ||
            mode === "generate" ||
            mode === "automate" ||
            mode === "crawl" ||
            mode === "map") && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">URL</span>
              <input
                className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                autoComplete="url"
                spellCheck={false}
              />
            </label>
          )}

          {mode === "search" && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">Search query</span>
              <textarea
                className="min-h-[88px] rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}

          {mode === "research" && (
            <>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--muted)]">
                  Research query (optional if URL is set)
                </span>
                <textarea
                  className="min-h-[88px] rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--muted)]">
                  URL (optional — used to build a default query)
                </span>
                <input
                  className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  autoComplete="url"
                  spellCheck={false}
                />
              </label>
            </>
          )}

          {mode === "automate" && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">Task (natural language)</span>
              <textarea
                className="min-h-[100px] rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}

          {mode === "generate" && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--muted)]">
                Instructions (shared schema: single `summary` string)
              </span>
              <textarea
                className="min-h-[88px] rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            aria-live="polite"
            aria-busy={loading}
            aria-label={
              loading
                ? `Running ${MODE_LABELS[mode]} (${modePairingHint(mode)})`
                : `Run ${MODE_LABELS[mode]} (${modePairingHint(mode)})`
            }
            className={`rounded-lg px-6 py-3 text-left outline-none transition-[transform,filter,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-55 ${RUN_BTN} ${
              loading
                ? ""
                : "hover:bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--card))] active:scale-[0.97] active:brightness-[0.95] active:shadow-[inset_0_2px_10px_rgba(0,0,0,0.14)] dark:active:shadow-[inset_0_2px_12px_rgba(0,0,0,0.45)]"
            }`}
          >
            {loading ? (
              <span className="flex flex-col gap-1">
                <span className="font-mono text-[15px] font-semibold">
                  Running… {formatElapsedShort(elapsedWhileRunningMs)}
                  {mode === "automate" && automateCapMs > 0 ? (
                    <span className="text-[13px] font-normal text-[var(--muted)]">
                      {" "}
                      (
                      {Math.max(
                        0,
                        Math.ceil(automateCapMs / 1000) -
                          Math.floor(elapsedWhileRunningMs / 1000)
                      )}
                      s cap)
                    </span>
                  ) : null}
                  <span className="text-[var(--muted)]"> · </span>
                  {MODE_LABELS[mode]}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {modePairingHint(mode)}
                </span>
              </span>
            ) : (
              <span className="flex flex-col gap-1">
                <span className="font-mono text-[15px] font-semibold">
                  Run · {MODE_LABELS[mode]}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {modePairingHint(mode)}
                </span>
              </span>
            )}
          </button>
        </form>

        {error && (
          <div
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
            role="alert"
          >
            {error}
          </div>
        )}

        {data && (
          <section className="mt-10 space-y-8">
            <p className="font-mono text-xs text-[var(--muted)]">
              {MODE_LABELS[data.mode]}
              {data.url ? ` · ${data.url}` : ""}
              {typeof data.context.query === "string"
                ? ` · query: ${(data.context.query as string).slice(0, 80)}${(data.context.query as string).length > 80 ? "…" : ""}`
                : ""}
              {" · "}
              {formatComparedAt(data.comparedAt)}
            </p>

            <div
              className={`grid gap-6 ${data.tabstack && data.firecrawl ? "md:grid-cols-2" : "md:grid-cols-1 max-w-xl"}`}
            >
              {data.tabstack ? (
                <MetricCard
                  name="Tabstack"
                  subtitle={data.tabstack.endpoint}
                  ok={data.tabstack.ok}
                  durationMs={data.tabstack.durationMs}
                  maxMs={maxMs}
                  accent="var(--tabstack)"
                  foot={tabstackFoot(data.tabstack)}
                  meta={metaLine(data.tabstack)}
                  notes={data.tabstack.notes}
                  error={data.tabstack.error}
                />
              ) : null}
              {data.firecrawl ? (
                <MetricCard
                  name="Firecrawl"
                  subtitle={data.firecrawl.endpoint}
                  ok={data.firecrawl.ok}
                  durationMs={data.firecrawl.durationMs}
                  maxMs={maxMs}
                  accent="var(--firecrawl)"
                  foot={firecrawlFoot(data.firecrawl)}
                  meta={metaLine(data.firecrawl)}
                  notes={data.firecrawl.notes}
                  error={data.firecrawl.error}
                />
              ) : null}
            </div>

            <CreditComparisonPanel data={data} />

            <LatencyBars
              tabstack={data.tabstack}
              firecrawl={data.firecrawl}
              maxMs={maxMs}
            />

            <JsonResponsePanel data={data} />

            <p className="text-xs leading-relaxed text-[var(--muted)]">
              Confirm current pricing in each vendor dashboard; rules change.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function tabstackFoot(t: BenchmarkRow) {
  if (t.estimatedUsd != null && t.estimatedUsd > 0) {
    return (
      <>
        <span className="font-mono">~${t.estimatedUsd.toFixed(4)}</span>
        <span className="text-[var(--muted)]">
          {" "}
          est. ({t.estimatedActions ?? 0} action)
        </span>
      </>
    );
  }
  return (
    <span className="text-[var(--muted)]">
      Tabstack pricing varies by product—see console.
    </span>
  );
}

function firecrawlFoot(f: BenchmarkRow) {
  const { value, source } = formatFirecrawlCreditsLive(f);
  return (
    <>
      <span className="font-mono">{value}</span>
      <span className="text-[var(--muted)]">
        {source === "measured" ? " (measured)" : " (typical / docs)"}
      </span>
    </>
  );
}

function CreditComparisonPanel({ data }: { data: ReportComparePayload }) {
  const mode = data.mode;
  const tabstackCell =
    data.tabstack != null
      ? TABSTACK_CREDITS_DISPLAY_PLACEHOLDER[mode]
      : "—";
  const fc = data.firecrawl;
  const fcLive = fc ? formatFirecrawlCreditsLive(fc) : null;

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-sm">
      <h3 className="font-serif text-lg font-medium">Credit comparison</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Firecrawl reflects live usage from{" "}
        <code className="rounded bg-[var(--surface)] px-1 py-0.5 font-mono text-[11px]">
          GET /v1/team/credit-usage
        </code>{" "}
        when measured. Tabstack is placeholder text in{" "}
        <code className="rounded bg-[var(--surface)] px-1 py-0.5 font-mono text-[11px]">
          src/lib/credit-comparison.ts
        </code>{" "}
        until you replace it.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Tabstack
          </p>
          <p className="mt-1 font-mono text-lg text-[var(--tabstack)]">{tabstackCell}</p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Firecrawl
          </p>
          {fcLive ? (
            <>
              <p className="mt-1 font-mono text-lg text-[var(--firecrawl)]">
                {fcLive.value}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {fcLive.source === "measured"
                  ? "Measured: balance dropped after the run (polled GET /v1/team/credit-usage until it did)"
                  : "Not measured: no drop seen while polling credit-usage (failed read, zero-cost call, or still lagging after ~15s). Showing typical credits from docs."}
              </p>
            </>
          ) : (
            <p className="mt-1 font-mono text-lg text-[var(--muted)]">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

function metaLine(b: BenchmarkRow) {
  return `${formatBytes(b.contentLength)} output · HTTP ${b.status}`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function jsonStringifyForDisplay(data: ReportComparePayload): string {
  return JSON.stringify(
    data,
    (key, value) => {
      if (key === "tabstack" && value === null) return undefined;
      if (key === "firecrawl" && value === null) return undefined;
      if (key === "preview" && typeof value === "string") {
        return `[${value.length} chars — see mode-specific output section below]`;
      }
      return value;
    },
    2
  );
}

function JsonResponsePanel({ data }: { data: ReportComparePayload }) {
  const formattedFull = JSON.stringify(data, null, 2);
  const formattedDisplay = jsonStringifyForDisplay(data);
  const previewCopy = OUTPUT_PREVIEW_COPY[data.mode];
  const showTabstack = data.tabstack != null;
  const showFirecrawl =
    data.firecrawl != null && previewCopy.firecrawlColumn != null;

  async function copyJson(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(formattedFull);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-sm">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="font-serif text-lg font-medium">{previewCopy.title}</h3>
          <span className="font-mono text-xs text-[var(--muted)]">
            {MODE_LABELS[data.mode]}
          </span>
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">{previewCopy.description}</p>
        <div
          className={`mt-3 grid gap-4 ${showTabstack && showFirecrawl ? "md:grid-cols-2" : "md:grid-cols-1"}`}
        >
          {showTabstack && previewCopy.tabstackColumn ? (
            <div>
              <p className="mb-1 font-mono text-[11px] font-medium leading-snug text-[var(--tabstack)]">
                {previewCopy.tabstackColumn}
              </p>
              <pre className="max-h-[min(400px,50vh)] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[var(--ink)]">
                {data.tabstack!.preview || "—"}
              </pre>
            </div>
          ) : null}
          {showFirecrawl ? (
            <div>
              <p className="mb-1 font-mono text-[11px] font-medium leading-snug text-[var(--firecrawl)]">
                {previewCopy.firecrawlColumn}
              </p>
              <pre className="max-h-[min(400px,50vh)] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[var(--ink)]">
                {data.firecrawl!.preview || "—"}
              </pre>
            </div>
          ) : null}
        </div>
      </div>

      <details className="group mt-6 border-t border-[var(--line)] pt-5">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg py-1 [&::-webkit-details-marker]:hidden">
          <div className="flex min-w-0 flex-1 gap-3">
            <span
              className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center text-[var(--muted)]"
              aria-hidden
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 transition-transform duration-200 group-open:rotate-90"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </span>
            <div className="min-w-0">
              <span className="font-serif text-lg font-medium">JSON response</span>
              <span className="mt-0.5 block text-sm text-[var(--muted)]">
                Raw <code className="font-mono text-[13px]">POST /api/compare</code>{" "}
                payload — expand to inspect; large{" "}
                <code className="font-mono text-[13px]">preview</code> strings stay shortened in
                the tree.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={copyJson}
            className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 font-mono text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--line)]/60"
          >
            Copy full JSON
          </button>
        </summary>
        <pre
          className="mt-4 max-h-[min(360px,55vh)] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 font-mono text-[11px] leading-relaxed text-[var(--ink)] [tab-size:2] whitespace-pre-wrap break-words"
          tabIndex={0}
        >
          {formattedDisplay}
        </pre>
      </details>
    </div>
  );
}

function MetricCard({
  name,
  subtitle,
  ok,
  durationMs,
  maxMs,
  accent,
  foot,
  meta,
  notes,
  error,
}: {
  name: string;
  subtitle: string;
  ok: boolean;
  durationMs: number;
  maxMs: number;
  accent: string;
  foot: React.ReactNode;
  meta: string;
  notes?: string;
  error?: string;
}) {
  const pct = Math.min(100, (durationMs / maxMs) * 100);
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-medium">{name}</h2>
          <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--muted)]">
            {subtitle}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            ok
              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
              : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          }`}
        >
          {ok ? "OK" : "Issue"}
        </span>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-2xl font-medium tabular-nums">
            {durationMs}
            <span className="text-base font-normal text-[var(--muted)]">
              {" "}
              ms
            </span>
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--line)]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: accent }}
          />
        </div>
      </div>
      <p className="mt-4 text-sm">{foot}</p>
      <p className="mt-2 font-mono text-[11px] text-[var(--muted)]">{meta}</p>
      {notes && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{notes}</p>
      )}
      {error && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 font-mono text-[11px] text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          {error}
        </p>
      )}
    </div>
  );
}

function LatencyBars({
  tabstack,
  firecrawl,
  maxMs,
}: {
  tabstack: BenchmarkRow | null;
  firecrawl: BenchmarkRow | null;
  maxMs: number;
}) {
  const blurb =
    tabstack && firecrawl
      ? "Wall-clock time per provider (parallel for paired modes)."
      : tabstack
        ? "Tabstack-only mode — single request."
        : "Firecrawl-only mode — single request.";

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5">
      <h3 className="font-serif text-lg font-medium">Response time</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">{blurb}</p>
      <div className="mt-5 space-y-4">
        {tabstack ? (
          <BarRow
            label="Tabstack"
            ms={tabstack.durationMs}
            maxMs={maxMs}
            color="var(--tabstack)"
          />
        ) : null}
        {firecrawl ? (
          <BarRow
            label="Firecrawl"
            ms={firecrawl.durationMs}
            maxMs={maxMs}
            color="var(--firecrawl)"
          />
        ) : null}
      </div>
    </div>
  );
}

function BarRow({
  label,
  ms,
  maxMs,
  color,
}: {
  label: string;
  ms: number;
  maxMs: number;
  color: string;
}) {
  const pct = (ms / maxMs) * 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-[var(--muted)]">
          {ms} ms
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-md bg-[var(--line)]">
        <div
          className="h-full rounded-md"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
