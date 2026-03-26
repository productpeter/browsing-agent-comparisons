/**
 * Firecrawl `GET /v1/team/credit-usage` returns a single account balance.
 * If two benchmark runs interleave (before₁ → before₂ → scrape₁ → scrape₂ → after₁ → after₂),
 * each run’s “before/after” delta is meaningless.
 *
 * Serialize each full **before → Firecrawl API call(s) → read response → after** sequence
 * so every endpoint run measures credits against a clean window.
 *
 * Tabstack calls can still run in parallel (`Promise.all`) — they don’t touch this balance.
 */
let chain: Promise<void> = Promise.resolve();

export async function withFirecrawlCreditMeasurement<T>(
  fn: () => Promise<T>
): Promise<T> {
  const prev = chain;
  let release!: () => void;
  chain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
