import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GENERATE_INSTRUCTIONS,
  DEFAULT_GENERATE_SCHEMA,
  FIRECRAWL_ONLY_MODES,
  MODE_ENDPOINT_PREVIEW,
  TABSTACK_ONLY_MODES,
  compareAutomate,
  compareGenerate,
  compareMarkdown,
  compareResearch,
  runCompareMode,
  type CompareMode,
} from "./compare-modes";
import {
  firecrawlScrapeResponseSuccessExample,
  tabstackExtractMarkdownResponseSuccessExample,
} from "./vendor-api-shapes";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

/** Minimal SSE body readable by `consumeSseResponse` */
function sseTextResponse(payload: string): Response {
  return new Response(`data: ${payload}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

const ALL_MODES: CompareMode[] = [
  "markdown",
  "generate",
  "automate",
  "research",
  "search",
  "crawl",
  "map",
];

describe("MODE_ENDPOINT_PREVIEW", () => {
  it("covers every mode; paths match Tabstack-only vs Firecrawl-only vs paired", () => {
    for (const m of ALL_MODES) {
      const row = MODE_ENDPOINT_PREVIEW[m];
      const onlyFc = (FIRECRAWL_ONLY_MODES as readonly string[]).includes(m);
      const onlyTs = (TABSTACK_ONLY_MODES as readonly string[]).includes(m);
      if (onlyFc) {
        expect(row.tabstack).toBeNull();
        expect(row.firecrawl).toMatch(/^POST \/v\d\//);
      } else if (onlyTs) {
        expect(row.firecrawl).toBeNull();
        expect(row.tabstack).toMatch(/^POST \/v\d\//);
      } else {
        expect(row.tabstack).toMatch(/^POST \/v\d\//);
        expect(row.firecrawl).toMatch(/^POST \/v\d\//);
      }
    }
  });
});

describe("endpoint pairs: Tabstack vs Firecrawl", () => {
  it("markdown: POST /v1/extract/markdown vs POST /v2/scrape", async () => {
    let creditCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.url;

      if (u.includes("api.firecrawl.dev/v1/team/credit-usage")) {
        creditCalls += 1;
        const remaining = creditCalls === 1 ? 1000 : 999;
        return jsonResponse({
          success: true,
          data: { remaining_credits: remaining },
        });
      }
      if (u.includes("tabstack.ai/v1/extract/markdown")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init?.body as string)).toEqual({
          url: "https://techcrunch.com/",
        });
        return jsonResponse(tabstackExtractMarkdownResponseSuccessExample);
      }
      if (u.includes("api.firecrawl.dev/v2/scrape")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        expect(body.actions).toBeUndefined();
        expect(init?.method).toBe("POST");
        return jsonResponse(firecrawlScrapeResponseSuccessExample);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { tabstack, firecrawl } = await compareMarkdown(
      "https://techcrunch.com/",
      "ts-key",
      "fc-key"
    );

    expect(tabstack.endpoint).toBe("POST /v1/extract/markdown");
    expect(tabstack.ok).toBe(true);
    expect(firecrawl.endpoint).toBe("POST /v2/scrape");
    expect(firecrawl.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("generate: POST /v1/generate/json vs POST /v2/extract (sync completion)", async () => {
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.url;

      if (u.includes("api.firecrawl.dev/v1/team/credit-usage")) {
        return jsonResponse({
          success: true,
          data: { remaining_credits: 500 },
        });
      }
      if (u.includes("tabstack.ai/v1/generate/json")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.url).toBe("https://techcrunch.com/");
        expect(body.instructions).toBe(DEFAULT_GENERATE_INSTRUCTIONS);
        expect(body.json_schema).toEqual(DEFAULT_GENERATE_SCHEMA);
        return jsonResponse({ summary: "Generated summary for tests." });
      }
      if (u.includes("api.firecrawl.dev/v2/extract")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.urls).toEqual(["https://techcrunch.com/"]);
        expect(body.prompt).toBe(DEFAULT_GENERATE_INSTRUCTIONS);
        expect(body.schema).toEqual(DEFAULT_GENERATE_SCHEMA);
        return jsonResponse({
          success: true,
          data: { summary: "Extracted summary for tests." },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { tabstack, firecrawl } = await compareGenerate(
      "https://techcrunch.com/",
      DEFAULT_GENERATE_INSTRUCTIONS,
      "ts-key",
      "fc-key"
    );

    expect(tabstack.endpoint).toBe("POST /v1/generate/json");
    expect(tabstack.ok).toBe(true);
    expect(firecrawl.endpoint).toContain("POST /v2/extract");
    expect(firecrawl.ok).toBe(true);
  });

  it("automate: POST /v1/automate (SSE) only (no Firecrawl column)", async () => {
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.url;

      if (u.includes("tabstack.ai/v1/automate")) {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["Accept"]).toBe(
          "text/event-stream"
        );
        const body = JSON.parse(init?.body as string);
        expect(body.task).toBe("Read the visible page title and the first headline link text.");
        expect(body.url).toBe("https://techcrunch.com/");
        return sseTextResponse('{"event":"complete","ok":true}');
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { tabstack, firecrawl } = await compareAutomate(
      "https://techcrunch.com/",
      "Read the visible page title and the first headline link text.",
      "ts-key"
    );

    expect(tabstack.endpoint).toBe("POST /v1/automate (SSE)");
    expect(tabstack.ok).toBe(true);
    expect(firecrawl).toBeNull();
  });

  it("research: POST /v1/research (SSE) vs POST /v1/deep-research", async () => {
    let creditCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.url;

      if (u.includes("api.firecrawl.dev/v1/team/credit-usage")) {
        creditCalls += 1;
        const remaining = creditCalls === 1 ? 200 : 194;
        return jsonResponse({
          success: true,
          data: { remaining_credits: remaining },
        });
      }
      if (u.includes("tabstack.ai/v1/research")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.query).toBe(
          "What venture or startup funding stories has TechCrunch emphasized recently?"
        );
        expect(body.mode).toBe("fast");
        return sseTextResponse('{"phase":"done"}');
      }
      if (u.includes("api.firecrawl.dev/v1/deep-research")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.query).toBe(
          "What venture or startup funding stories has TechCrunch emphasized recently?"
        );
        expect(body.maxDepth).toBe(2);
        return jsonResponse({
          success: true,
          data: {
            finalAnalysis:
              "Recent coverage highlights several Series A–C rounds and notable investors.",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { tabstack, firecrawl } = await compareResearch(
      "What venture or startup funding stories has TechCrunch emphasized recently?",
      "ts-key",
      "fc-key"
    );

    expect(tabstack.endpoint).toBe("POST /v1/research (SSE)");
    expect(tabstack.ok).toBe(true);
    expect(firecrawl.endpoint).toBe("POST /v1/deep-research");
    expect(firecrawl.ok).toBe(true);
    expect(firecrawl.preview).toContain("Series");
  });

  it("firecrawl deep research polls GET when POST returns only a job id", async () => {
    vi.useFakeTimers();
    let creditCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.url;

      if (u.includes("api.firecrawl.dev/v1/team/credit-usage")) {
        creditCalls += 1;
        const remaining = creditCalls === 1 ? 200 : 194;
        return jsonResponse({
          success: true,
          data: { remaining_credits: remaining },
        });
      }
      if (u.includes("tabstack.ai/v1/research")) {
        return sseTextResponse('{"phase":"done"}');
      }
      if (u.includes("api.firecrawl.dev/v1/deep-research")) {
        if (init?.method === "POST") {
          return jsonResponse({
            success: true,
            id: "job-async-1",
          });
        }
        expect(u).toContain("job-async-1");
        return jsonResponse({
          success: true,
          status: "completed",
          data: {
            finalAnalysis: "Polled synthesis text.",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const p = compareResearch("test query?", "ts-key", "fc-key");
    await vi.advanceTimersByTimeAsync(2000);
    const { firecrawl } = await p;

    vi.useRealTimers();

    expect(firecrawl.endpoint).toBe("POST /v1/deep-research (+ GET poll)");
    expect(firecrawl.ok).toBe(true);
    expect(firecrawl.preview).toBe("Polled synthesis text.");
  });
});

describe("runCompareMode", () => {
  it("dispatches research when only url is provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo, init?: RequestInit) => {
        const u = typeof input === "string" ? input : input.url;
        if (u.includes("credit-usage")) {
          return jsonResponse({
            success: true,
            data: { remaining_credits: 50 },
          });
        }
        if (u.includes("/research")) {
          return sseTextResponse("{}");
        }
        if (u.includes("deep-research")) {
          return jsonResponse({
            success: true,
            data: { finalAnalysis: "ok" },
          });
        }
        throw new Error(u);
      })
    );

    const out = await runCompareMode(
      "research",
      { url: "https://techcrunch.com/" },
      "ts",
      "fc"
    );

    expect(out.context.query).toContain("techcrunch.com");
    expect(out.tabstack.endpoint).toContain("research");
    expect(out.firecrawl.endpoint).toContain("deep-research");
  });

  it("search mode runs Firecrawl only (no Tabstack)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo) => {
        const u = typeof input === "string" ? input : input.url;
        if (u.includes("credit-usage")) {
          return jsonResponse({
            success: true,
            data: { remaining_credits: 100 },
          });
        }
        if (u.includes("/v2/search")) {
          return jsonResponse({
            success: true,
            data: { web: [{ url: "https://a.test", title: "A" }] },
          });
        }
        throw new Error(u);
      })
    );

    const out = await runCompareMode(
      "search",
      { query: "hello world" },
      undefined,
      "fc-key"
    );

    expect(out.tabstack).toBeNull();
    expect(out.firecrawl.endpoint).toBe("POST /v2/search");
    expect(out.firecrawl.ok).toBe(true);
  });

  it("automate mode runs Tabstack only (no Firecrawl key needed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo) => {
        const u = typeof input === "string" ? input : input.url;
        if (u.includes("/v1/automate")) {
          return sseTextResponse("{}");
        }
        throw new Error(u);
      })
    );

    const out = await runCompareMode(
      "automate",
      { url: "https://example.com/", task: "Summarize the headline" },
      "ts-key",
      undefined
    );

    expect(out.firecrawl).toBeNull();
    expect(out.tabstack?.endpoint).toContain("automate");
  });
});
