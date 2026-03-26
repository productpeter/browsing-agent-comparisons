/**
 * Tabstack markdown extract + Firecrawl scrape helpers for benchmarking.
 * Pricing references (verify on vendor sites): Firecrawl bills scrape credits;
 * Tabstack publishes per-action pricing for markdown extraction.
 */

import { withFirecrawlCreditMeasurement } from "./firecrawl-credit-lock";

const TABSTACK_EXTRACT = "https://api.tabstack.ai/v1/extract/markdown";
const FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_CREDITS = "https://api.firecrawl.dev/v1/team/credit-usage";

/** Published: ~$1 / 1k markdown actions — used when the API does not return usage. */
export const TABSTACK_MARKDOWN_USD_PER_ACTION = 0.001;

export async function getFirecrawlRemainingCredits(
  apiKey: string
): Promise<number | null> {
  const res = await fetch(FIRECRAWL_CREDITS, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json: unknown = await res.json();
  const data = json as { data?: { remaining_credits?: number } };
  const n = data.data?.remaining_credits;
  return typeof n === "number" ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Override via FIRECRAWL_CREDIT_POLL_MAX_MS / FIRECRAWL_CREDIT_POLL_INTERVAL_MS (tests). */
function readCreditPollOptions(): { intervalMs: number; maxWaitMs: number } {
  const maxRaw = process.env.FIRECRAWL_CREDIT_POLL_MAX_MS;
  const intRaw = process.env.FIRECRAWL_CREDIT_POLL_INTERVAL_MS;
  const maxWaitMs =
    maxRaw != null &&
    maxRaw !== "" &&
    Number.isFinite(Number(maxRaw)) &&
    Number(maxRaw) > 0
      ? Number(maxRaw)
      : 15_000;
  const intervalMs =
    intRaw != null &&
    intRaw !== "" &&
    Number.isFinite(Number(intRaw)) &&
    Number(intRaw) > 0
      ? Number(intRaw)
      : 400;
  return { intervalMs, maxWaitMs };
}

/**
 * After a Firecrawl request finishes, poll `GET /v1/team/credit-usage` until
 * `remaining_credits` drops below `before` (usage can post a beat after the
 * response body), or the wait budget is exhausted. Returns the last `after`
 * value that satisfied `before > after`, or the final read on timeout.
 */
export async function pollFirecrawlCreditsAfter(
  before: number | null,
  apiKey: string
): Promise<number | null> {
  if (before === null) {
    return getFirecrawlRemainingCredits(apiKey);
  }

  const { intervalMs, maxWaitMs } = readCreditPollOptions();
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const after = await getFirecrawlRemainingCredits(apiKey);
    if (after !== null && before > after) {
      return after;
    }
    await sleep(intervalMs);
  }

  return getFirecrawlRemainingCredits(apiKey);
}

export type TabstackExtractResult = {
  durationMs: number;
  ok: boolean;
  status: number;
  contentLength: number;
  /** Estimated from published pricing when usage is not in the response. */
  estimatedActions: number;
  estimatedUsd: number;
  error?: string;
  /** Full markdown text returned by the API (not truncated). */
  preview: string;
};

export async function tabstackExtractMarkdown(
  url: string,
  apiKey: string
): Promise<TabstackExtractResult> {
  const start = performance.now();
  const res = await fetch(TABSTACK_EXTRACT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url }),
  });
  const durationMs = Math.round(performance.now() - start);
  const json: unknown = await res.json().catch(() => ({}));
  const obj = json as { content?: string; error?: string; message?: string };
  const content = typeof obj.content === "string" ? obj.content : "";
  const errMsg = !res.ok
    ? String(obj.error || obj.message || `HTTP ${res.status}`)
    : undefined;

  return {
    durationMs,
    ok: res.ok,
    status: res.status,
    contentLength: content.length,
    estimatedActions: res.ok ? 1 : 0,
    estimatedUsd: res.ok ? TABSTACK_MARKDOWN_USD_PER_ACTION : 0,
    error: errMsg,
    preview: content,
  };
}

export type FirecrawlScrapeResult = {
  durationMs: number;
  ok: boolean;
  status: number;
  contentLength: number;
  /** From remaining-credits delta when available. */
  creditsUsed: number | null;
  creditsEstimated: number;
  creditsMeasured: boolean;
  error?: string;
  /** Full markdown text returned by the API (not truncated). */
  preview: string;
};

export async function firecrawlScrapeMarkdown(
  url: string,
  apiKey: string
): Promise<FirecrawlScrapeResult> {
  return withFirecrawlCreditMeasurement(async () => {
    /** 1) Balance before the scrape (first call / cold start baseline). */
    const before = await getFirecrawlRemainingCredits(apiKey);

    const start = performance.now();
    const res = await fetch(FIRECRAWL_SCRAPE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });

    /** 2) Finish the request fully, then 3) poll balance again (credits apply after work completes). */
    const json: unknown = await res.json().catch(() => ({}));
    const durationMs = Math.round(performance.now() - start);

    const after = await pollFirecrawlCreditsAfter(before, apiKey);

    const obj = json as {
      success?: boolean;
      data?: { markdown?: string };
      error?: string;
    };
    const markdown =
      typeof obj.data?.markdown === "string" ? obj.data.markdown : "";
    const ok = res.ok && obj.success === true;
    const errMsg = ok
      ? undefined
      : (obj.error as string | undefined) || `HTTP ${res.status}`;

    /** Require a strictly lower balance (after polling; see `pollFirecrawlCreditsAfter`). */
    let creditsUsed: number | null = null;
    if (before !== null && after !== null && before > after) {
      creditsUsed = before - after;
    }

    /** Base scrape is documented as 1 credit/page for standard markdown. */
    const creditsEstimated = 1;

    return {
      durationMs,
      ok,
      status: res.status,
      contentLength: markdown.length,
      creditsUsed,
      creditsEstimated,
      creditsMeasured: creditsUsed !== null,
      error: errMsg,
      preview: markdown,
    };
  });
}
