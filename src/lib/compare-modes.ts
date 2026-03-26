import {
  firecrawlScrapeMarkdown,
  getFirecrawlRemainingCredits,
  pollFirecrawlCreditsAfter,
  tabstackExtractMarkdown,
  type FirecrawlScrapeResult,
  type TabstackExtractResult,
} from "@/lib/apis";
import { withFirecrawlCreditMeasurement } from "@/lib/firecrawl-credit-lock";
import { consumeSseResponse } from "@/lib/sse";

export type CompareMode =
  | "markdown"
  | "generate"
  | "automate"
  | "research"
  | "search"
  | "crawl"
  | "map";

/** Modes with no Tabstack equivalent — only Firecrawl runs. */
export const FIRECRAWL_ONLY_MODES: readonly CompareMode[] = [
  "search",
  "crawl",
  "map",
] as const;

/** No comparable Firecrawl NL agent in this app — Tabstack automate only. */
export const TABSTACK_ONLY_MODES: readonly CompareMode[] = ["automate"] as const;

export function isFirecrawlOnlyMode(mode: CompareMode): boolean {
  return (FIRECRAWL_ONLY_MODES as readonly string[]).includes(mode);
}

export function isTabstackOnlyMode(mode: CompareMode): boolean {
  return (TABSTACK_ONLY_MODES as readonly string[]).includes(mode);
}

/**
 * Human-readable API routes this benchmark hits (matches `BenchmarkRow.endpoint` labels on success).
 * Shown in the UI when a mode is selected so you don’t need to run first to see paths.
 */
export const MODE_ENDPOINT_PREVIEW: Record<
  CompareMode,
  { tabstack: string | null; firecrawl: string | null }
> = {
  markdown: {
    tabstack: "POST /v1/extract/markdown",
    firecrawl: "POST /v2/scrape",
  },
  generate: {
    tabstack: "POST /v1/generate/json",
    firecrawl: "POST /v2/extract (+ GET /v2/extract/{id})",
  },
  automate: {
    tabstack: "POST /v1/automate (SSE)",
    firecrawl: null,
  },
  research: {
    tabstack: "POST /v1/research (SSE)",
    firecrawl: "POST /v1/deep-research (+ GET poll)",
  },
  search: {
    tabstack: null,
    firecrawl: "POST /v2/search",
  },
  crawl: {
    tabstack: null,
    firecrawl: "POST /v2/crawl (+ GET poll)",
  },
  map: {
    tabstack: null,
    firecrawl: "POST /v2/map",
  },
};

function requireTabstackKey(key: string | undefined): string {
  if (!key?.trim()) {
    throw new Error("TABSTACK_API_KEY (or TABS_API_KEY) required for this mode");
  }
  return key;
}

function requireFirecrawlKey(key: string | undefined): string {
  if (!key?.trim()) {
    throw new Error("FIRECRAWL_API_KEY required for this mode");
  }
  return key;
}

const TABSTACK_BASE = "https://api.tabstack.ai/v1";

/**
 * Tabstack `/automate` can stream for a long time (real browser work).
 * Default: abort after 60s so the UI does not hang. Set `TABSTACK_AUTOMATE_TIMEOUT_MS=0` to wait until the server closes the stream.
 */
function getTabstackAutomateSseTimeoutMs(): number | undefined {
  const raw = process.env.TABSTACK_AUTOMATE_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 60_000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 60_000;
  if (n <= 0) return undefined;
  return n;
}

/** Rough parity with Tabstack “generate” pricing tier (verify on tabstack.ai). */
const TABSTACK_GENERATE_ESTIMATE_USD = 0.005;

export const DEFAULT_GENERATE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "One paragraph summary of the page’s main content",
    },
  },
  required: ["summary"],
} as const;

export const DEFAULT_GENERATE_INSTRUCTIONS =
  "Summarize TechCrunch’s homepage: main themes and the most prominent headlines in one clear paragraph.";

export type BenchmarkRow = {
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

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function firecrawlCredits(
  before: number | null,
  after: number | null
): { used: number | null; measured: boolean } {
  /** Same as `apis.ts`: positive delta after `pollFirecrawlCreditsAfter` (or timeout). */
  if (before !== null && after !== null && before > after) {
    return { used: before - after, measured: true };
  }
  return { used: null, measured: false };
}

function tabstackMarkdownRow(r: TabstackExtractResult): BenchmarkRow {
  return {
    durationMs: r.durationMs,
    ok: r.ok,
    status: r.status,
    contentLength: r.contentLength,
    preview: r.preview,
    endpoint: "POST /v1/extract/markdown",
    estimatedActions: r.estimatedActions,
    estimatedUsd: r.estimatedUsd,
    error: r.error,
  };
}

function firecrawlScrapeRow(r: FirecrawlScrapeResult, endpoint: string): BenchmarkRow {
  return {
    durationMs: r.durationMs,
    ok: r.ok,
    status: r.status,
    contentLength: r.contentLength,
    preview: r.preview,
    endpoint,
    creditsUsed: r.creditsUsed,
    creditsEstimated: r.creditsEstimated,
    creditsMeasured: r.creditsMeasured,
    error: r.error,
  };
}

export async function compareMarkdown(
  url: string,
  tabstackKey: string,
  firecrawlKey: string
): Promise<{ tabstack: BenchmarkRow; firecrawl: BenchmarkRow }> {
  const [t, f] = await Promise.all([
    tabstackExtractMarkdown(url, tabstackKey),
    firecrawlScrapeMarkdown(url, firecrawlKey),
  ]);
  return {
    tabstack: tabstackMarkdownRow(t),
    firecrawl: firecrawlScrapeRow(f, "POST /v2/scrape"),
  };
}

async function tabstackGenerateJson(
  url: string,
  jsonSchema: object,
  instructions: string,
  apiKey: string
): Promise<BenchmarkRow> {
  const start = performance.now();
  const res = await fetch(`${TABSTACK_BASE}/generate/json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      json_schema: jsonSchema,
      instructions,
    }),
  });
  const durationMs = Math.round(performance.now() - start);
  const text = await res.text();
  let preview = text;
  try {
    preview = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    /* raw error body */
  }
  return {
    durationMs,
    ok: res.ok,
    status: res.status,
    contentLength: preview.length,
    preview,
    endpoint: "POST /v1/generate/json",
    estimatedActions: res.ok ? 1 : 0,
    estimatedUsd: res.ok ? TABSTACK_GENERATE_ESTIMATE_USD : 0,
    error: res.ok ? undefined : preview.slice(0, 500),
  };
}

async function firecrawlExtractWithPoll(
  url: string,
  schema: object,
  prompt: string,
  apiKey: string
): Promise<BenchmarkRow> {
  return withFirecrawlCreditMeasurement(async () => {
  const before = await getFirecrawlRemainingCredits(apiKey);
  const start = performance.now();

  const post = await fetch("https://api.firecrawl.dev/v2/extract", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls: [url],
      schema,
      prompt,
    }),
  });

  const postJson = (await post.json().catch(() => ({}))) as {
    success?: boolean;
    id?: string;
    error?: string;
    data?: unknown;
  };

  if (!post.ok && !postJson.id) {
    return {
      durationMs: Math.round(performance.now() - start),
      ok: false,
      status: post.status,
      contentLength: 0,
      preview: "",
      endpoint: "POST /v2/extract",
      creditsUsed: null,
      creditsEstimated: 0,
      creditsMeasured: false,
      error: postJson.error || `HTTP ${post.status}`,
    };
  }

  if (postJson.success && postJson.data !== undefined && !postJson.id) {
    const preview = JSON.stringify(postJson.data, null, 2);
    const after = await pollFirecrawlCreditsAfter(before, apiKey);
    const { used, measured } = firecrawlCredits(before, after);
    return {
      durationMs: Math.round(performance.now() - start),
      ok: true,
      status: post.status,
      contentLength: preview.length,
      preview,
      endpoint: "POST /v2/extract",
      creditsUsed: used,
      creditsEstimated: 1,
      creditsMeasured: measured,
      notes: "Completed synchronously.",
    };
  }

  const id = postJson.id;
  if (!id) {
    return {
      durationMs: Math.round(performance.now() - start),
      ok: false,
      status: post.status,
      contentLength: 0,
      preview: "",
      endpoint: "POST /v2/extract",
      creditsUsed: null,
      creditsEstimated: 0,
      creditsMeasured: false,
      error: postJson.error || "No extract job id returned",
    };
  }

  const deadline = Date.now() + 5 * 60 * 1000;
  let completedData: unknown;
  let completed = false;
  let failError: string | undefined;

  while (Date.now() < deadline) {
    await sleep(2000);
    const stRes = await fetch(`https://api.firecrawl.dev/v2/extract/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    const st = (await stRes.json().catch(() => ({}))) as {
      success?: boolean;
      status?: string;
      data?: unknown;
      error?: string;
    };

    if (st.status === "completed" && st.success) {
      completedData = st.data;
      completed = true;
      break;
    }
    if (st.status === "failed" || st.status === "cancelled") {
      failError = st.error || `Extract ${st.status}`;
      break;
    }
  }

  const durationMs = Math.round(performance.now() - start);
  const after = await pollFirecrawlCreditsAfter(before, apiKey);
  const { used, measured } = firecrawlCredits(before, after);

  if (failError) {
    return {
      durationMs,
      ok: false,
      status: 500,
      contentLength: 0,
      preview: "",
      endpoint: "POST /v2/extract (+ poll)",
      creditsUsed: used,
      creditsEstimated: 1,
      creditsMeasured: measured,
      error: failError,
    };
  }

  if (!completed) {
    return {
      durationMs,
      ok: false,
      status: 504,
      contentLength: 0,
      preview: "",
      endpoint: "POST /v2/extract (+ poll)",
      creditsUsed: used,
      creditsEstimated: 1,
      creditsMeasured: measured,
      error: "Timed out waiting for extract job (5 min)",
    };
  }

  const preview = JSON.stringify(completedData ?? {}, null, 2);
  return {
    durationMs,
    ok: true,
    status: 200,
    contentLength: preview.length,
    preview,
    endpoint: "POST /v2/extract (+ GET /v2/extract/{id})",
    creditsUsed: used,
    creditsEstimated: 1,
    creditsMeasured: measured,
    notes: "LLM structured extract; job polled until completed.",
  };
  });
}

export async function compareGenerate(
  url: string,
  instructions: string,
  tabstackKey: string,
  firecrawlKey: string
): Promise<{ tabstack: BenchmarkRow; firecrawl: BenchmarkRow }> {
  const schema = DEFAULT_GENERATE_SCHEMA as unknown as object;
  const [t, f] = await Promise.all([
    tabstackGenerateJson(url, schema, instructions, tabstackKey),
    firecrawlExtractWithPoll(url, schema, instructions, firecrawlKey),
  ]);
  return { tabstack: t, firecrawl: f };
}

function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === "AbortError" || e.message === "This operation was aborted")
  );
}

async function tabstackSseBenchmark(
  path: "/automate" | "/research",
  body: Record<string, unknown>,
  apiKey: string,
  endpointLabel: string,
  options?: { timeoutMs?: number }
): Promise<BenchmarkRow> {
  const start = performance.now();
  const signal =
    options?.timeoutMs != null && options.timeoutMs > 0
      ? AbortSignal.timeout(options.timeoutMs)
      : undefined;

  try {
    const res = await fetch(`${TABSTACK_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
    const { raw, events } = await consumeSseResponse(res);
    const durationMs = Math.round(performance.now() - start);
    const preview =
      raw.length > 0
        ? raw
        : JSON.stringify(events, null, 2);
    const ok = res.ok;
    return {
      durationMs,
      ok,
      status: res.status,
      contentLength: preview.length,
      preview,
      endpoint: endpointLabel,
      estimatedActions: ok ? 1 : 0,
      error: ok ? undefined : preview.slice(0, 800),
      notes: options?.timeoutMs
        ? "SSE until complete or client timeout (see TABSTACK_AUTOMATE_TIMEOUT_MS for automate)."
        : "SSE stream until the connection closes.",
    };
  } catch (e: unknown) {
    const durationMs = Math.round(performance.now() - start);
    if (
      isAbortError(e) &&
      options?.timeoutMs != null &&
      options.timeoutMs > 0
    ) {
      return {
        durationMs,
        ok: false,
        status: 504,
        contentLength: 0,
        preview: "",
        endpoint: endpointLabel,
        estimatedActions: 0,
        error: `Timed out after ${Math.round(options.timeoutMs / 1000)}s (Tabstack automate SSE). Set TABSTACK_AUTOMATE_TIMEOUT_MS=0 for no cap, or a higher value.`,
        notes: "Client timeout so runs do not hang indefinitely.",
      };
    }
    throw e;
  }
}

export async function compareAutomate(
  url: string,
  task: string,
  tabstackKey: string
): Promise<{ tabstack: BenchmarkRow; firecrawl: null }> {
  const automateTimeoutMs = getTabstackAutomateSseTimeoutMs();
  const t = await tabstackSseBenchmark(
    "/automate",
    { task, url },
    tabstackKey,
    "POST /v1/automate (SSE)",
    automateTimeoutMs != null
      ? { timeoutMs: automateTimeoutMs }
      : undefined
  );
  return { tabstack: t, firecrawl: null };
}

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

/** Firecrawl Search — no Tabstack equivalent in this app. */
export async function firecrawlSearchWeb(
  query: string,
  apiKey: string
): Promise<BenchmarkRow> {
  return withFirecrawlCreditMeasurement(async () => {
  const before = await getFirecrawlRemainingCredits(apiKey);
  const start = performance.now();
  const res = await fetch(`${FIRECRAWL_V2}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit: 8,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: unknown;
    error?: string;
  };
  const durationMs = Math.round(performance.now() - start);
  const after = await pollFirecrawlCreditsAfter(before, apiKey);
  const { used, measured } = firecrawlCredits(before, after);
  const preview = JSON.stringify(json.data ?? json, null, 2);
  const ok = res.ok && json.success !== false;
  return {
    durationMs,
    ok,
    status: res.status,
    contentLength: preview.length,
    preview,
    endpoint: "POST /v2/search",
    creditsUsed: used,
    creditsEstimated: 2,
    creditsMeasured: measured,
    error: ok ? undefined : json.error || `HTTP ${res.status}`,
    notes:
      "No Tabstack search API in this benchmark — Firecrawl only. Adjust limit/scrapeOptions in code if needed.",
  };
  });
}

/** Firecrawl Map — no Tabstack equivalent in this app. */
export async function firecrawlMapSite(
  url: string,
  apiKey: string
): Promise<BenchmarkRow> {
  return withFirecrawlCreditMeasurement(async () => {
  const before = await getFirecrawlRemainingCredits(apiKey);
  const start = performance.now();
  const res = await fetch(`${FIRECRAWL_V2}/map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      limit: 500,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    links?: Array<{ url: string; title?: string }>;
    data?: { links?: Array<{ url: string; title?: string }> };
    error?: string;
  };
  const durationMs = Math.round(performance.now() - start);
  const after = await pollFirecrawlCreditsAfter(before, apiKey);
  const { used, measured } = firecrawlCredits(before, after);
  const linkList = json.links ?? json.data?.links;
  const preview =
    linkList && linkList.length > 0
      ? linkList
          .slice(0, 200)
          .map((l) => (l.title ? `${l.title}\n${l.url}` : l.url))
          .join("\n\n")
      : JSON.stringify(json, null, 2);
  const ok = res.ok && json.success !== false;
  return {
    durationMs,
    ok,
    status: res.status,
    contentLength: preview.length,
    preview,
    endpoint: "POST /v2/map",
    creditsUsed: used,
    creditsEstimated: 1,
    creditsMeasured: measured,
    error: ok ? undefined : json.error || `HTTP ${res.status}`,
    notes:
      "No Tabstack map endpoint here — Firecrawl only. Preview lists up to 200 URLs.",
  };
  });
}

/** Firecrawl Crawl — async job + GET poll. No Tabstack equivalent in this app. */
export async function firecrawlCrawlSite(
  url: string,
  apiKey: string
): Promise<BenchmarkRow> {
  return withFirecrawlCreditMeasurement(async () => {
  const before = await getFirecrawlRemainingCredits(apiKey);
  const start = performance.now();

  const post = await fetch(`${FIRECRAWL_V2}/crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      limit: 25,
      maxDiscoveryDepth: 1,
      scrapeOptions: {
        formats: [{ type: "markdown" }],
        onlyMainContent: true,
      },
    }),
  });

  const postJson = (await post.json().catch(() => ({}))) as {
    success?: boolean;
    id?: string;
    error?: string;
  };

  if (!post.ok || !postJson.success || !postJson.id) {
    const durationMs = Math.round(performance.now() - start);
    const after = await pollFirecrawlCreditsAfter(before, apiKey);
    const { used, measured } = firecrawlCredits(before, after);
    return {
      durationMs,
      ok: false,
      status: post.status,
      contentLength: 0,
      preview: JSON.stringify(postJson, null, 2),
      endpoint: "POST /v2/crawl",
      creditsUsed: used,
      creditsEstimated: 5,
      creditsMeasured: measured,
      error: postJson.error || `HTTP ${post.status}`,
      notes: "Crawl returns a job id; poll GET /v2/crawl/{id} for pages.",
    };
  }

  const jobId = postJson.id;
  const pollDeadline = Date.now() + 10 * 60 * 1000;
  let failError: string | undefined;
  let finalPayload: {
    status?: string;
    data?: Array<{ markdown?: string; metadata?: { sourceURL?: string } }>;
  } | null = null;

  while (Date.now() < pollDeadline) {
    await sleep(2500);
    const stRes = await fetch(
      `${FIRECRAWL_V2}/crawl/${encodeURIComponent(jobId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      }
    );
    const st = (await stRes.json().catch(() => ({}))) as {
      success?: boolean;
      status?: string;
      data?: Array<{ markdown?: string; metadata?: { sourceURL?: string } }>;
      error?: string;
    };

    if (st.status === "failed") {
      failError = st.error || "Crawl failed";
      break;
    }
    if (st.status === "completed") {
      finalPayload = st;
      break;
    }
    if (st.success === false) {
      failError = st.error || "Crawl error";
      break;
    }
  }

  const durationMs = Math.round(performance.now() - start);
  const after = await pollFirecrawlCreditsAfter(before, apiKey);
  const { used, measured } = firecrawlCredits(before, after);

  if (failError) {
    return {
      durationMs,
      ok: false,
      status: 500,
      contentLength: 0,
      preview: "",
      endpoint: "POST /v2/crawl (+ GET poll)",
      creditsUsed: used,
      creditsEstimated: 5,
      creditsMeasured: measured,
      error: failError,
      notes: "Poll GET /v2/crawl/{id} until status is completed.",
    };
  }

  if (!finalPayload?.data || finalPayload.data.length === 0) {
    return {
      durationMs,
      ok: false,
      status: 504,
      contentLength: 0,
      preview: "",
      endpoint: "POST /v2/crawl (+ GET poll)",
      creditsUsed: used,
      creditsEstimated: 5,
      creditsMeasured: measured,
      error:
        "Timed out or empty crawl data (10 min cap). Try a smaller limit/depth.",
      notes: "Completed status should include data[] with markdown per page.",
    };
  }

  const preview = finalPayload.data
    .slice(0, 15)
    .map((p, i) => {
      const u = p.metadata?.sourceURL ?? `page ${i + 1}`;
      const md = p.markdown ?? "";
      const cap = 4000;
      return `## ${u}\n\n${md.length > cap ? `${md.slice(0, cap)}…` : md}`;
    })
    .join("\n\n---\n\n");

  return {
    durationMs,
    ok: true,
    status: 200,
    contentLength: preview.length,
    preview,
    endpoint: "POST /v2/crawl (+ GET poll)",
    creditsUsed: used,
    creditsEstimated: Math.max(1, finalPayload.data.length),
    creditsMeasured: measured,
    notes:
      "No Tabstack multi-page crawl here — Firecrawl only. Preview: first 15 pages, markdown truncated per page.",
  };
  });
}

type FirecrawlDeepResearchBody = {
  query: string;
  maxDepth: number;
  timeLimit: number;
  maxUrls: number;
};

async function firecrawlDeepResearch(
  query: string,
  apiKey: string
): Promise<BenchmarkRow> {
  return withFirecrawlCreditMeasurement(async () => {
  const body: FirecrawlDeepResearchBody = {
    query,
    maxDepth: 2,
    timeLimit: 120,
    maxUrls: 6,
  };

  const before = await getFirecrawlRemainingCredits(apiKey);
  const start = performance.now();

  const res = await fetch("https://api.firecrawl.dev/v1/deep-research", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const postJson = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    id?: string;
    data?: {
      finalAnalysis?: string;
      activities?: unknown[];
      sources?: unknown[];
    };
    error?: string;
  };

  /** Sync completion: full analysis in the POST body (see Firecrawl docs). */
  const syncAnalysis = postJson.data?.finalAnalysis;
  if (
    res.ok &&
    postJson.success === true &&
    typeof syncAnalysis === "string" &&
    syncAnalysis.length > 0
  ) {
    const durationMs = Math.round(performance.now() - start);
    const after = await pollFirecrawlCreditsAfter(before, apiKey);
    const { used, measured } = firecrawlCredits(before, after);
    return {
      durationMs,
      ok: true,
      status: res.status,
      contentLength: syncAnalysis.length,
      preview: syncAnalysis,
      endpoint: "POST /v1/deep-research",
      creditsUsed: used,
      creditsEstimated: 6,
      creditsMeasured: measured,
      notes:
        "Alpha API; may be deprecated in favor of Search. Credits often scale with URLs analyzed.",
    };
  }

  /** Async job: POST returns `{ success, id }` — poll GET until `finalAnalysis` is ready. */
  const jobId = postJson.id;
  if (!res.ok || !postJson.success || !jobId) {
    const durationMs = Math.round(performance.now() - start);
    const after = await pollFirecrawlCreditsAfter(before, apiKey);
    const { used, measured } = firecrawlCredits(before, after);
    const preview = JSON.stringify(postJson, null, 2);
    return {
      durationMs,
      ok: false,
      status: res.status,
      contentLength: preview.length,
      preview,
      endpoint: "POST /v1/deep-research",
      creditsUsed: used,
      creditsEstimated: 6,
      creditsMeasured: measured,
      error:
        postJson.error ||
        (!jobId
          ? "Firecrawl returned no job id — expected GET /v1/deep-research/{id} polling."
          : `HTTP ${res.status}`),
      notes:
        "Alpha API; async jobs require polling GET /v1/deep-research/{id} (see Firecrawl docs).",
    };
  }

  const pollDeadline = Date.now() + 10 * 60 * 1000;
  let failError: string | undefined;
  let analysis: string | undefined;

  while (Date.now() < pollDeadline) {
    await sleep(2000);
    const stRes = await fetch(
      `https://api.firecrawl.dev/v1/deep-research/${encodeURIComponent(jobId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      }
    );
    const st = (await stRes.json().catch(() => ({}))) as {
      success?: boolean;
      status?: string;
      data?: {
        finalAnalysis?: string;
        final_analysis?: string;
        activities?: unknown[];
        sources?: unknown[];
      };
      error?: string;
    };

    const fromData =
      typeof st.data?.finalAnalysis === "string"
        ? st.data.finalAnalysis
        : typeof st.data?.final_analysis === "string"
          ? st.data.final_analysis
          : undefined;

    if (typeof fromData === "string" && fromData.length > 0) {
      analysis = fromData;
      break;
    }

    if (st.status === "failed" || st.status === "cancelled") {
      failError = st.error || `Deep research ${st.status}`;
      break;
    }
    if (st.success === false) {
      failError = st.error || "Deep research failed";
      break;
    }
  }

  const durationMs = Math.round(performance.now() - start);
  const after = await pollFirecrawlCreditsAfter(before, apiKey);
  const { used, measured } = firecrawlCredits(before, after);

  if (failError) {
    return {
      durationMs,
      ok: false,
      status: 500,
      contentLength: 0,
      preview: "",
      endpoint: "POST /v1/deep-research (+ GET poll)",
      creditsUsed: used,
      creditsEstimated: 6,
      creditsMeasured: measured,
      error: failError,
      notes:
        "Alpha API; async jobs use GET /v1/deep-research/{id} until status completed.",
    };
  }

  if (!analysis) {
    return {
      durationMs,
      ok: false,
      status: 504,
      contentLength: 0,
      preview: "",
      endpoint: "POST /v1/deep-research (+ GET poll)",
      creditsUsed: used,
      creditsEstimated: 6,
      creditsMeasured: measured,
      error:
        "Timed out waiting for Firecrawl deep-research finalAnalysis (10 min cap).",
      notes:
        "Poll GET /v1/deep-research/{jobId} until data.finalAnalysis is present.",
    };
  }

  return {
    durationMs,
    ok: true,
    status: 200,
    contentLength: analysis.length,
    preview: analysis,
    endpoint: "POST /v1/deep-research (+ GET poll)",
    creditsUsed: used,
    creditsEstimated: 6,
    creditsMeasured: measured,
    notes:
      "Alpha API; POST may return only job id — results fetched via GET poll. Credits often scale with URLs analyzed.",
  };
  });
}

export async function compareResearch(
  query: string,
  tabstackKey: string,
  firecrawlKey: string
): Promise<{ tabstack: BenchmarkRow; firecrawl: BenchmarkRow }> {
  const [t, f] = await Promise.all([
    tabstackSseBenchmark(
      "/research",
      { query, mode: "fast" },
      tabstackKey,
      "POST /v1/research (SSE)"
    ),
    firecrawlDeepResearch(query, firecrawlKey),
  ]);
  return { tabstack: t, firecrawl: f };
}

export async function runCompareMode(
  mode: CompareMode,
  opts: {
    url?: string;
    task?: string;
    query?: string;
    instructions?: string;
  },
  tabstackKey: string | undefined,
  firecrawlKey: string | undefined
): Promise<{
  tabstack: BenchmarkRow | null;
  firecrawl: BenchmarkRow | null;
  context: Record<string, unknown>;
}> {
  const instructions = opts.instructions?.trim() || DEFAULT_GENERATE_INSTRUCTIONS;

  switch (mode) {
    case "markdown": {
      if (!opts.url) throw new Error("Missing `url`");
      const r = await compareMarkdown(
        opts.url,
        requireTabstackKey(tabstackKey),
        requireFirecrawlKey(firecrawlKey)
      );
      return { ...r, context: {} };
    }
    case "generate": {
      if (!opts.url) throw new Error("Missing `url`");
      const r = await compareGenerate(
        opts.url,
        instructions,
        requireTabstackKey(tabstackKey),
        requireFirecrawlKey(firecrawlKey)
      );
      return { ...r, context: { instructions } };
    }
    case "automate": {
      if (!opts.url) throw new Error("Missing `url`");
      const task = opts.task?.trim();
      if (!task) {
        throw new Error("Missing `task` for automate mode");
      }
      const r = await compareAutomate(
        opts.url,
        task,
        requireTabstackKey(tabstackKey)
      );
      return { ...r, context: { task } };
    }
    case "research": {
      const queryRaw = opts.query?.trim();
      const query =
        queryRaw ||
        (opts.url
          ? `Summarize credible sources and key facts about: ${opts.url}`
          : "");
      if (!query) {
        throw new Error("Provide `query` and/or `url` for research mode");
      }
      const r = await compareResearch(
        query,
        requireTabstackKey(tabstackKey),
        requireFirecrawlKey(firecrawlKey)
      );
      return { ...r, context: { query } };
    }
    case "search": {
      const q = opts.query?.trim();
      if (!q) throw new Error("Missing `query` for search mode");
      const f = await firecrawlSearchWeb(q, requireFirecrawlKey(firecrawlKey));
      return { tabstack: null, firecrawl: f, context: { query: q } };
    }
    case "crawl": {
      if (!opts.url) throw new Error("Missing `url`");
      const f = await firecrawlCrawlSite(
        opts.url,
        requireFirecrawlKey(firecrawlKey)
      );
      return { tabstack: null, firecrawl: f, context: {} };
    }
    case "map": {
      if (!opts.url) throw new Error("Missing `url`");
      const f = await firecrawlMapSite(opts.url, requireFirecrawlKey(firecrawlKey));
      return { tabstack: null, firecrawl: f, context: {} };
    }
  }
}
