import { describe, expect, it } from "vitest";
import { formatFirecrawlCreditsLive } from "./credit-comparison";

describe("formatFirecrawlCreditsLive", () => {
  it("prefers measured credits", () => {
    expect(
      formatFirecrawlCreditsLive({
        durationMs: 1,
        ok: true,
        status: 200,
        contentLength: 0,
        preview: "",
        endpoint: "POST /v2/scrape",
        creditsUsed: 3,
        creditsEstimated: 1,
        creditsMeasured: true,
      })
    ).toEqual({ value: "3 credits", source: "measured" });
  });

  it("uses singular credit for 1", () => {
    expect(
      formatFirecrawlCreditsLive({
        durationMs: 1,
        ok: true,
        status: 200,
        contentLength: 0,
        preview: "",
        endpoint: "POST /v2/scrape",
        creditsUsed: 1,
        creditsEstimated: 1,
        creditsMeasured: true,
      })
    ).toEqual({ value: "1 credit", source: "measured" });
  });

  it("falls back to estimated when not measured", () => {
    expect(
      formatFirecrawlCreditsLive({
        durationMs: 1,
        ok: true,
        status: 200,
        contentLength: 0,
        preview: "",
        endpoint: "POST /v2/scrape",
        creditsUsed: null,
        creditsEstimated: 2,
        creditsMeasured: false,
      })
    ).toEqual({ value: "~2 credit(s)", source: "estimated" });
  });
});
