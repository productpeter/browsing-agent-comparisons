/**
 * Reference JSON for the **vendor HTTP APIs** this app calls.
 * Shapes follow Tabstack / Firecrawl docs; vendors may add fields over time.
 * Use these to diff responses in tests or when integrating manually.
 */

/** Body we send: POST https://api.tabstack.ai/v1/extract/markdown */
export const tabstackExtractMarkdownRequestExample = {
  url: "https://techcrunch.com/",
} as const;

/** Typical 200 JSON from Tabstack markdown extract (see quickstart). */
export const tabstackExtractMarkdownResponseSuccessExample = {
  url: "https://techcrunch.com/",
  content:
    "---\ntitle: TechCrunch | Startup and Technology News\n---\n\n# TechCrunch\n\nStartup and technology news.",
} as const;

/** Error-style body when HTTP status is non-2xx (shape varies). */
export const tabstackExtractMarkdownResponseErrorExample = {
  error: "Unauthorized",
  message: "Invalid API key",
} as const;

/** Body we send: POST https://api.firecrawl.dev/v2/scrape */
export const firecrawlScrapeRequestExample = {
  url: "https://techcrunch.com/",
  formats: ["markdown"] as const,
  onlyMainContent: true,
} as const;

/** Typical 200 JSON from Firecrawl v2 scrape (success + data.markdown). */
export const firecrawlScrapeResponseSuccessExample = {
  success: true,
  data: {
    markdown: "# TechCrunch\n\nStartup and technology news.",
    metadata: {
      title: "TechCrunch | Startup and Technology News",
      description: "Technology news and analysis",
      language: "en",
    },
  },
} as const;

/** Non-success scrape (HTTP may still be 200 with success: false, or 4xx/5xx). */
export const firecrawlScrapeResponseFailureExample = {
  success: false,
  error: "Insufficient credits",
} as const;

/** GET https://api.firecrawl.dev/v1/team/credit-usage — 200 body. */
export const firecrawlCreditUsageResponseExample = {
  success: true,
  data: {
    remaining_credits: 3_000,
    plan_credits: 3_000,
    billing_period_start: "2025-01-01T00:00:00Z",
    billing_period_end: "2025-01-31T23:59:59Z",
  },
} as const;

/**
 * Normalized JSON returned by **this app**: `POST /api/compare`
 * (not a vendor API — built from both providers above).
 * For modes `search`, `crawl`, `map`, `tabstack` is `null` and `firecrawlOnly` is `true`.
 * For `automate`, `firecrawl` is `null` and `tabstackOnly` is `true`.
 */
export const compareApiResponseExample = {
  url: "https://techcrunch.com/",
  comparedAt: "2025-03-22T18:00:00.000Z",
  tabstack: {
    durationMs: 842,
    ok: true,
    status: 200,
    contentLength: 120,
    estimatedActions: 1,
    estimatedUsd: 0.001,
    preview: "# TechCrunch\n\n…",
  },
  firecrawl: {
    durationMs: 910,
    ok: true,
    status: 200,
    contentLength: 115,
    creditsUsed: 1,
    creditsEstimated: 1,
    creditsMeasured: true,
    preview: "# TechCrunch\n\n…",
  },
} as const;
