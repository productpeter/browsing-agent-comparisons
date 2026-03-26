import { NextResponse } from "next/server";
import {
  type CompareMode,
  isFirecrawlOnlyMode,
  isTabstackOnlyMode,
  runCompareMode,
} from "@/lib/compare-modes";

export const maxDuration = 300;

function getTabstackKey(): string | undefined {
  return (
    process.env.TABSTACK_API_KEY ||
    process.env.TABS_API_KEY ||
    undefined
  );
}

function getFirecrawlKey(): string | undefined {
  return process.env.FIRECRAWL_API_KEY;
}

function parseMode(raw: unknown): CompareMode | null {
  if (raw === undefined || raw === null || raw === "") return "markdown";
  if (
    raw === "markdown" ||
    raw === "generate" ||
    raw === "automate" ||
    raw === "research" ||
    raw === "search" ||
    raw === "crawl" ||
    raw === "map"
  ) {
    return raw;
  }
  return null;
}

export async function POST(request: Request) {
  let body: {
    mode?: unknown;
    url?: unknown;
    task?: unknown;
    query?: unknown;
    instructions?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = parseMode(body.mode);
  if (!mode) {
    return NextResponse.json(
      {
        error:
          "Invalid `mode` — use markdown, generate, automate, research, search, crawl, or map",
      },
      { status: 400 }
    );
  }

  const urlRaw = typeof body.url === "string" ? body.url.trim() : "";
  const task = typeof body.task === "string" ? body.task : undefined;
  const query = typeof body.query === "string" ? body.query : undefined;
  const instructions =
    typeof body.instructions === "string" ? body.instructions : undefined;

  if (mode === "search") {
    if (!query?.trim()) {
      return NextResponse.json(
        { error: "Missing `query` for search mode" },
        { status: 400 }
      );
    }
  } else if (mode === "research") {
    if (!urlRaw && !(query && query.trim())) {
      return NextResponse.json(
        { error: "Provide `url` and/or `query` for research mode" },
        { status: 400 }
      );
    }
  } else if (!urlRaw) {
    return NextResponse.json({ error: "Missing `url`" }, { status: 400 });
  }

  let parsedHref: string | undefined;
  if (urlRaw) {
    let parsed: URL;
    try {
      parsed = new URL(urlRaw);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL — include scheme, e.g. https://example.com" },
        { status: 400 }
      );
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json(
        { error: "Only http(s) URLs are allowed" },
        { status: 400 }
      );
    }
    parsedHref = parsed.href;
  }

  const tabstackKey = getTabstackKey();
  const firecrawlKey = getFirecrawlKey();

  const needsFirecrawl = !isTabstackOnlyMode(mode);
  if (needsFirecrawl && !firecrawlKey) {
    return NextResponse.json(
      {
        error: "Set FIRECRAWL_API_KEY in the environment.",
      },
      { status: 503 }
    );
  }

  const needsTabstack = !isFirecrawlOnlyMode(mode);
  if (needsTabstack && !tabstackKey) {
    return NextResponse.json(
      {
        error:
          "Set TABSTACK_API_KEY (or TABS_API_KEY) for modes that call Tabstack (markdown, generate, automate, research), or use search / crawl / map (Firecrawl only).",
      },
      { status: 503 }
    );
  }

  try {
    const { tabstack, firecrawl, context } = await runCompareMode(
      mode,
      {
        url: parsedHref,
        task,
        query,
        instructions,
      },
      tabstackKey,
      firecrawlKey
    );

    return NextResponse.json({
      mode,
      url: parsedHref ?? null,
      context,
      tabstack,
      firecrawl,
      firecrawlOnly: isFirecrawlOnlyMode(mode),
      tabstackOnly: isTabstackOnlyMode(mode),
      comparedAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Comparison failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
