import { afterEach, describe, expect, it, vi } from "vitest";
import {
  firecrawlScrapeMarkdown,
  getFirecrawlRemainingCredits,
  tabstackExtractMarkdown,
} from "./apis";
import {
  firecrawlCreditUsageResponseExample,
  firecrawlScrapeRequestExample,
  firecrawlScrapeResponseFailureExample,
  firecrawlScrapeResponseSuccessExample,
  tabstackExtractMarkdownRequestExample,
  tabstackExtractMarkdownResponseErrorExample,
  tabstackExtractMarkdownResponseSuccessExample,
} from "./vendor-api-shapes";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tabstack POST /v1/extract/markdown", () => {
  it("sends the documented JSON body and maps a success response", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const u = typeof input === "string" ? input : input.url;
      expect(u).toContain("tabstack.ai/v1/extract/markdown");
      return Promise.resolve(
        jsonResponse(tabstackExtractMarkdownResponseSuccessExample)
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await tabstackExtractMarkdown(
      tabstackExtractMarkdownRequestExample.url,
      "test-key"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(
      tabstackExtractMarkdownRequestExample
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.contentLength).toBe(
      tabstackExtractMarkdownResponseSuccessExample.content.length
    );
    expect(result.preview.startsWith("---")).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("maps an error JSON body when HTTP fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(tabstackExtractMarkdownResponseErrorExample, {
          status: 401,
        })
      )
    );

    const result = await tabstackExtractMarkdown(
      "https://techcrunch.com/",
      "bad-key"
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBeDefined();
    expect(result.estimatedUsd).toBe(0);
  });
});

describe("Firecrawl GET /v1/team/credit-usage", () => {
  it("reads remaining_credits from the documented envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(firecrawlCreditUsageResponseExample))
    );

    const remaining = await getFirecrawlRemainingCredits("fc-key");
    expect(remaining).toBe(
      firecrawlCreditUsageResponseExample.data.remaining_credits
    );
  });
});

describe("Firecrawl POST /v2/scrape (+ credit polls)", () => {
  it("sends the documented scrape body and maps success + credit delta", async () => {
    const beforeCredits = { ...firecrawlCreditUsageResponseExample };
    const afterCredits = {
      ...firecrawlCreditUsageResponseExample,
      data: {
        ...firecrawlCreditUsageResponseExample.data,
        remaining_credits:
          firecrawlCreditUsageResponseExample.data.remaining_credits - 1,
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(beforeCredits)) // credit before
      .mockResolvedValueOnce(
        jsonResponse(firecrawlScrapeResponseSuccessExample)
      ) // scrape
      .mockResolvedValueOnce(jsonResponse(afterCredits)); // credit after

    vi.stubGlobal("fetch", fetchMock);

    const result = await firecrawlScrapeMarkdown(
      firecrawlScrapeRequestExample.url,
      "fc-key"
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const scrapeCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(scrapeCall[0]).toContain("firecrawl.dev/v2/scrape");
    expect(JSON.parse(scrapeCall[1].body as string)).toEqual(
      firecrawlScrapeRequestExample
    );

    expect(result.ok).toBe(true);
    expect(result.creditsMeasured).toBe(true);
    expect(result.creditsUsed).toBe(1);
    expect(result.contentLength).toBe(
      firecrawlScrapeResponseSuccessExample.data.markdown.length
    );
  });

  it("treats unchanged remaining_credits as unmeasured after polling (not 0 credits)", async () => {
    const same = { ...firecrawlCreditUsageResponseExample };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const u = typeof input === "string" ? input : input.url;
      if (u.includes("credit-usage")) {
        return Promise.resolve(jsonResponse(same));
      }
      if (u.includes("v2/scrape")) {
        return Promise.resolve(jsonResponse(firecrawlScrapeResponseSuccessExample));
      }
      return Promise.reject(new Error(`unexpected ${u}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await firecrawlScrapeMarkdown(
      firecrawlScrapeRequestExample.url,
      "fc-key"
    );

    expect(result.creditsMeasured).toBe(false);
    expect(result.creditsUsed).toBeNull();
    expect(result.creditsEstimated).toBe(1);
    expect(
      fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("credit-usage")
      ).length
    ).toBeGreaterThan(2);
  });

  it("measures credits when balance updates on a later poll (stale first read)", async () => {
    const beforeCredits = { ...firecrawlCreditUsageResponseExample };
    const staleAfter = { ...firecrawlCreditUsageResponseExample };
    const afterCredits = {
      ...firecrawlCreditUsageResponseExample,
      data: {
        ...firecrawlCreditUsageResponseExample.data,
        remaining_credits:
          firecrawlCreditUsageResponseExample.data.remaining_credits - 1,
      },
    };
    let creditHits = 0;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const u = typeof input === "string" ? input : input.url;
      if (u.includes("credit-usage")) {
        creditHits += 1;
        if (creditHits === 1) return Promise.resolve(jsonResponse(beforeCredits));
        if (creditHits === 2) return Promise.resolve(jsonResponse(staleAfter));
        return Promise.resolve(jsonResponse(afterCredits));
      }
      if (u.includes("v2/scrape")) {
        return Promise.resolve(jsonResponse(firecrawlScrapeResponseSuccessExample));
      }
      return Promise.reject(new Error(`unexpected ${u}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await firecrawlScrapeMarkdown(
      firecrawlScrapeRequestExample.url,
      "fc-key"
    );

    expect(result.creditsMeasured).toBe(true);
    expect(result.creditsUsed).toBe(1);
    expect(creditHits).toBeGreaterThanOrEqual(3);
  });

  it("maps failure when success is not true", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const u = typeof input === "string" ? input : input.url;
      if (u.includes("credit-usage")) {
        return Promise.resolve(jsonResponse(firecrawlCreditUsageResponseExample));
      }
      if (u.includes("v2/scrape")) {
        return Promise.resolve(
          jsonResponse(firecrawlScrapeResponseFailureExample, { status: 402 })
        );
      }
      return Promise.reject(new Error(`unexpected ${u}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await firecrawlScrapeMarkdown(
      "https://techcrunch.com/",
      "fc-key"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
