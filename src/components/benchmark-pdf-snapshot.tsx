"use client";

import {
  formatFirecrawlCreditsLive,
  TABSTACK_CREDITS_DISPLAY_PLACEHOLDER,
} from "@/lib/credit-comparison";
import type { ReportComparePayload } from "@/lib/comparison-report-pdf";
import type { BenchmarkRow, CompareMode } from "@/lib/compare-modes";
import { forwardRef, useEffect, useState, type CSSProperties } from "react";

/** Long outputs — cap so the canvas stays reasonable; full data stays in the app. */
const MAX_PREVIEW_CHARS = 18_000;

const MODE_ORDER: CompareMode[] = [
  "markdown",
  "generate",
  "automate",
  "research",
  "search",
  "crawl",
  "map",
];

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
      "Tabstack language agent — SSE stream from POST /v1/automate for your task on the URL.",
    tabstackColumn: "Tabstack · automate (SSE)",
  },
  research: {
    title: "Research output",
    description:
      "Tabstack: raw SSE from /research. Firecrawl: synthesized text from deep-research.",
    tabstackColumn: "Tabstack · research (SSE)",
    firecrawlColumn: "Firecrawl · deep-research",
  },
  search: {
    title: "Search results",
    description: "Firecrawl POST /v2/search — no Tabstack equivalent in this app.",
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

/** Light editorial theme — PDF always matches the warm UI, not system dark mode. */
const LIGHT: CSSProperties = {
  colorScheme: "light",
  /** Solid bg — html2canvas’s CSS parser chokes on some `var()` / modern color stacks. */
  backgroundColor: "#f6f3ee",
  ["--surface" as string]: "#f6f3ee",
  ["--card" as string]: "#fffcf7",
  ["--ink" as string]: "#1c1914",
  ["--muted" as string]: "#6b6560",
  ["--line" as string]: "#e2dcd3",
  ["--accent" as string]: "#c45c26",
  ["--tabstack" as string]: "#2563eb",
  ["--firecrawl" as string]: "#ea580c",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatComparedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

function metaLine(b: BenchmarkRow): string {
  return `${formatBytes(b.contentLength)} output · HTTP ${b.status}`;
}

function truncatePreview(s: string): string {
  if (s.length <= MAX_PREVIEW_CHARS) return s;
  return `${s.slice(0, MAX_PREVIEW_CHARS)}\n\n… [truncated at ${MAX_PREVIEW_CHARS.toLocaleString("en-US")} chars for PDF]`;
}

function jsonStringifyForDisplay(data: ReportComparePayload): string {
  return JSON.stringify(
    data,
    (key, value) => {
      if (key === "tabstack" && value === null) return undefined;
      if (key === "firecrawl" && value === null) return undefined;
      if (key === "preview" && typeof value === "string") {
        return `[${value.length} chars — see output sections above]`;
      }
      return value;
    },
    2
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

function SnapshotMetricCard({
  name,
  subtitle,
  ok,
  durationMs,
  maxMs,
  accentVar,
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
  accentVar: string;
  foot: React.ReactNode;
  meta: string;
  notes?: string;
  error?: string;
}) {
  const pct = Math.min(100, (durationMs / maxMs) * 100);
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-[0_1px_2px_0_rgba(0,0,0,0.06)]">
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
              ? "bg-emerald-100 text-emerald-900"
              : "bg-amber-100 text-amber-900"
          }`}
        >
          {ok ? "OK" : "Issue"}
        </span>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-2xl font-medium tabular-nums">
            {durationMs}
            <span className="text-base font-normal text-[var(--muted)]"> ms</span>
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--line)]">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: `var(${accentVar})` }}
          />
        </div>
      </div>
      <p className="mt-4 text-sm">{foot}</p>
      <p className="mt-2 font-mono text-[11px] text-[var(--muted)]">{meta}</p>
      {notes && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{notes}</p>
      )}
      {error && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 font-mono text-[11px] text-amber-950">
          {error}
        </p>
      )}
    </div>
  );
}

function SnapshotBarRow({
  label,
  ms,
  maxMs,
  colorVar,
}: {
  label: string;
  ms: number;
  maxMs: number;
  colorVar: string;
}) {
  const pct = (ms / maxMs) * 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-[var(--muted)]">{ms} ms</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-md bg-[var(--line)]">
        <div
          className="h-full rounded-md"
          style={{ width: `${pct}%`, backgroundColor: `var(${colorVar})` }}
        />
      </div>
    </div>
  );
}

function SnapshotLatencyBars({
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
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-[0_1px_2px_0_rgba(0,0,0,0.06)]">
      <h3 className="font-serif text-lg font-medium">Response time</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">{blurb}</p>
      <div className="mt-5 space-y-4">
        {tabstack ? (
          <SnapshotBarRow
            label="Tabstack"
            ms={tabstack.durationMs}
            maxMs={maxMs}
            colorVar="--tabstack"
          />
        ) : null}
        {firecrawl ? (
          <SnapshotBarRow
            label="Firecrawl"
            ms={firecrawl.durationMs}
            maxMs={maxMs}
            colorVar="--firecrawl"
          />
        ) : null}
      </div>
    </div>
  );
}

function SnapshotCreditPanel({
  data,
  mode,
}: {
  data: ReportComparePayload;
  mode: CompareMode;
}) {
  const tabstackCell =
    data.tabstack != null
      ? TABSTACK_CREDITS_DISPLAY_PLACEHOLDER[mode]
      : "—";
  const fc = data.firecrawl;
  const fcLive = fc ? formatFirecrawlCreditsLive(fc) : null;

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-[0_1px_2px_0_rgba(0,0,0,0.06)]">
      <h3 className="font-serif text-lg font-medium">Credit comparison</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Firecrawl usage from{" "}
        <code className="rounded bg-[var(--surface)] px-1 py-0.5 font-mono text-[11px]">
          GET /v1/team/credit-usage
        </code>{" "}
        when measured. Tabstack placeholder until you wire real numbers.
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
                  ? "Measured (balance dropped after the run)"
                  : "Estimated from docs when usage delta unavailable"}
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

function contextLine(data: ReportComparePayload): string {
  const parts: string[] = [];
  if (data.url) parts.push(data.url);
  const q = data.context.query;
  if (typeof q === "string" && q.trim()) parts.push(q.slice(0, 120) + (q.length > 120 ? "…" : ""));
  return parts.length ? parts.join(" · ") : "—";
}

function ModeSnapshotSection({
  data,
  modeLabels,
}: {
  data: ReportComparePayload;
  modeLabels: Record<CompareMode, string>;
}) {
  const mode = data.mode;
  const previewCopy = OUTPUT_PREVIEW_COPY[mode];
  const showTabstack = data.tabstack != null;
  const showFirecrawl =
    data.firecrawl != null && previewCopy.firecrawlColumn != null;
  const maxMs = Math.max(
    data.tabstack?.durationMs ?? 0,
    data.firecrawl?.durationMs ?? 0,
    1
  );

  return (
    <section className="mb-12 space-y-4">
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] pb-4">
        <span className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg bg-[#efe4dc] px-2 font-mono text-sm font-semibold text-[var(--ink)]">
          {modeLabels[mode]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
            {mode}
          </p>
          <p className="mt-0.5 break-words font-mono text-xs text-[var(--muted)]">
            {contextLine(data)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
            {formatComparedAt(data.comparedAt)}
          </p>
        </div>
      </div>

      <div
        className={`grid gap-6 ${data.tabstack && data.firecrawl ? "md:grid-cols-2" : "md:grid-cols-1"}`}
      >
        {data.tabstack ? (
          <SnapshotMetricCard
            name="Tabstack"
            subtitle={data.tabstack.endpoint}
            ok={data.tabstack.ok}
            durationMs={data.tabstack.durationMs}
            maxMs={maxMs}
            accentVar="--tabstack"
            foot={tabstackFoot(data.tabstack)}
            meta={metaLine(data.tabstack)}
            notes={data.tabstack.notes}
            error={data.tabstack.error}
          />
        ) : null}
        {data.firecrawl ? (
          <SnapshotMetricCard
            name="Firecrawl"
            subtitle={data.firecrawl.endpoint}
            ok={data.firecrawl.ok}
            durationMs={data.firecrawl.durationMs}
            maxMs={maxMs}
            accentVar="--firecrawl"
            foot={firecrawlFoot(data.firecrawl)}
            meta={metaLine(data.firecrawl)}
            notes={data.firecrawl.notes}
            error={data.firecrawl.error}
          />
        ) : null}
      </div>

      <SnapshotCreditPanel data={data} mode={mode} />

      <SnapshotLatencyBars
        tabstack={data.tabstack}
        firecrawl={data.firecrawl}
        maxMs={maxMs}
      />

      <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-[0_1px_2px_0_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="font-serif text-lg font-medium">{previewCopy.title}</h3>
          <span className="font-mono text-xs text-[var(--muted)]">
            {modeLabels[mode]}
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
              <pre className="max-h-[520px] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[var(--ink)]">
                {truncatePreview(data.tabstack!.preview || "—")}
              </pre>
            </div>
          ) : null}
          {showFirecrawl ? (
            <div>
              <p className="mb-1 font-mono text-[11px] font-medium leading-snug text-[var(--firecrawl)]">
                {previewCopy.firecrawlColumn}
              </p>
              <pre className="max-h-[520px] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[var(--ink)]">
                {truncatePreview(data.firecrawl!.preview || "—")}
              </pre>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-[0_1px_2px_0_rgba(0,0,0,0.06)]">
        <h3 className="font-serif text-lg font-medium">JSON response</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Raw <code className="font-mono text-[13px]">POST /api/compare</code>{" "}
          payload (preview fields shortened in tree).
        </p>
        <pre className="mt-4 max-h-[360px] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 font-mono text-[11px] leading-relaxed text-[var(--ink)] [tab-size:2] whitespace-pre-wrap break-words">
          {jsonStringifyForDisplay(data)}
        </pre>
      </div>
    </section>
  );
}

function EmptySnapshot() {
  return (
    <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-12 text-center font-mono text-sm text-[var(--muted)]">
      No benchmark runs yet — run a mode and export again.
    </p>
  );
}

type Props = {
  resultsByMode: Record<CompareMode, ReportComparePayload | null>;
  modeLabels: Record<CompareMode, string>;
};

export const BenchmarkPdfSnapshot = forwardRef<HTMLDivElement, Props>(
  function BenchmarkPdfSnapshot({ resultsByMode, modeLabels }, ref) {
    const present = MODE_ORDER.filter((m) => resultsByMode[m] != null);
    /** Set after mount — `new Date()` during SSR vs hydrate differs and causes hydration errors. */
    const [pdfGeneratedLabel, setPdfGeneratedLabel] = useState<string | null>(
      null
    );
    useEffect(() => {
      setPdfGeneratedLabel(formatComparedAt(new Date().toISOString()));
    }, []);

    return (
      <div
        ref={ref}
        style={LIGHT}
        className="box-border w-[794px] bg-[var(--surface)] px-10 py-12 text-[var(--ink)] antialiased"
      >
        <header className="mb-10 border-b border-[var(--line)] pb-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Benchmark
          </p>
          <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-[var(--ink)]">
            Tabstack vs Firecrawl
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
            Paired runs across every mode you have saved. This export is a
            pixel snapshot of the benchmark UI (same layout as the app).
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <div
              className="h-1 w-28 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, #c45c26 0%, rgba(196, 92, 38, 0) 100%)",
              }}
            />
            <p className="font-mono text-xs text-[var(--muted)]">
              PDF generated {pdfGeneratedLabel ?? "—"} · {present.length} of{" "}
              {MODE_ORDER.length} modes
            </p>
          </div>
        </header>

        {present.length === 0 ? (
          <EmptySnapshot />
        ) : (
          present.map((m) => {
            const data = resultsByMode[m];
            if (!data) return null;
            return (
              <ModeSnapshotSection
                key={m}
                data={data}
                modeLabels={modeLabels}
              />
            );
          })
        )}

        <footer className="mt-12 border-t border-[var(--line)] pt-6 text-center font-mono text-[11px] text-[var(--muted)]">
          browsing-agent-comparisons · confirm pricing in each vendor dashboard
        </footer>
      </div>
    );
  }
);
