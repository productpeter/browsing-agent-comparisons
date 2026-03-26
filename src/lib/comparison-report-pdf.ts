import type { BenchmarkRow, CompareMode } from "@/lib/compare-modes";

/** Matches `POST /api/compare` success body — used for PDF export & UI state. */
export type ReportComparePayload = {
  mode: CompareMode;
  url: string | null;
  context: Record<string, unknown>;
  comparedAt: string;
  tabstack: BenchmarkRow | null;
  firecrawl: BenchmarkRow | null;
  firecrawlOnly?: boolean;
  tabstackOnly?: boolean;
};
