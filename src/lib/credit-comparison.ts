import type { BenchmarkRow, CompareMode } from "./compare-modes";

/**
 * Tabstack side of the credit comparison — replace values when you have final numbers.
 * Shown only when this run included a Tabstack column (`tabstack` non-null).
 */
export const TABSTACK_CREDITS_DISPLAY_PLACEHOLDER: Record<CompareMode, string> = {
  markdown: "—",
  generate: "—",
  automate: "—",
  research: "—",
  search: "—",
  crawl: "—",
  map: "—",
};

/** Firecrawl: live from `BenchmarkRow` (measured Δ via GET /v1/team/credit-usage when available). */
export function formatFirecrawlCreditsLive(f: BenchmarkRow): {
  value: string;
  source: "measured" | "estimated";
} {
  if (f.creditsMeasured && f.creditsUsed !== null) {
    return {
      value: `${f.creditsUsed} credit${f.creditsUsed === 1 ? "" : "s"}`,
      source: "measured",
    };
  }
  return {
    value: `~${f.creditsEstimated ?? 0} credit(s)`,
    source: "estimated",
  };
}
