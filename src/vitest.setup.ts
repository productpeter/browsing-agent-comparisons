/**
 * Fast Firecrawl credit polling in tests (mocks often return a fixed balance).
 * Production uses defaults in `apis.ts` (15s max, 400ms interval).
 */
process.env.FIRECRAWL_CREDIT_POLL_MAX_MS = "500";
process.env.FIRECRAWL_CREDIT_POLL_INTERVAL_MS = "50";
