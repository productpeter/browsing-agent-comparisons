# Browsing agent comparisons

Small [Next.js](https://nextjs.org/) app that compares **Tabstack** and **Firecrawl** where there is a reasonable pair, and runs **Firecrawl-only** modes when Tabstack has no matching API in this app. Pick a **mode** in the UI (or `mode` in the API body):

| Mode | Tabstack | Firecrawl |
|------|----------|-----------|
| **markdown** | `POST /v1/extract/markdown` | `POST /v2/scrape` (markdown) |
| **generate** | `POST /v1/generate/json` | `POST /v2/extract` (+ poll `GET /v2/extract/{id}`) with the same schema + instructions |
| **automate** | `POST /v1/automate` (SSE) | — (**Tabstack-only** here — no comparable Firecrawl NL agent in this app) |
| **research** | `POST /v1/research` (SSE, `mode: fast`) | `POST /v1/deep-research` then **`GET /v1/deep-research/{id}`** until `finalAnalysis` |
| **search** | — | **`POST /v2/search`** only (no Tabstack column) |
| **crawl** | — | **`POST /v2/crawl`** + **`GET /v2/crawl/{id}`** poll (no Tabstack column) |
| **map** | — | **`POST /v2/map`** only (no Tabstack column) |

- **Latency** — wall-clock time (parallel requests per mode).
- **Cost** — Firecrawl credits via `GET /v1/team/credit-usage` when possible; Tabstack estimates where used are rough (see [Tabstack pricing](https://tabstack.ai/pricing)).

## Setup

```bash
cp .env.example .env.local
# Add FIRECRAWL_API_KEY (required for all modes **except** automate — automate is Tabstack-only). TABSTACK_API_KEY is required for markdown, generate, automate, research (not for search / crawl / map).
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a public `https://` URL, and run the comparison.

## API

`POST /api/compare` — same metrics as the UI. Body:

- **`mode`** (optional, default `markdown`): `markdown` \| `generate` \| `automate` \| `research` \| `search` \| `crawl` \| `map`
- **`url`**: required for `markdown`, `generate`, `automate`, `crawl`, `map`; optional for `research` if `query` is set; omit for `search`
- **`task`**: required for `automate` (natural-language task for Tabstack)
- **`query`**: required for `search`; optional for `research` (defaults using `url` if omitted)
- **`instructions`**: optional for `generate` (shared with both providers)

Response includes `tabstack: null` and `firecrawlOnly: true` for `search`, `crawl`, and `map`.

Example: `{ "mode": "generate", "url": "https://techcrunch.com/", "instructions": "Summarize TechCrunch’s homepage: main themes and the most prominent headlines in one clear paragraph." }`

## JSON shapes (for comparison)

- **Vendor request/response examples** (what Tabstack and Firecrawl return): see [`src/lib/vendor-api-shapes.ts`](src/lib/vendor-api-shapes.ts). That file documents bodies for:
  - Tabstack `POST /v1/extract/markdown`
  - Firecrawl `POST /v2/scrape` and `GET /v1/team/credit-usage`
  - This app’s combined **`POST /api/compare`** payload (`compareApiResponseExample`)

## Tests

Unit tests mock `fetch` (no real API keys) and assert request bodies and parsing:

```bash
npm test
```

- `src/lib/apis.test.ts` — Tabstack markdown + Firecrawl scrape/credits helpers.
- `src/lib/compare-modes.test.ts` — paired modes, deep-research polling, Firecrawl-only `search`, and Tabstack-only `automate`.

## Notes

- **Automate (Tabstack)** streams real browser work over SSE and can take a long time. This app **aborts Tabstack automate after 60s by default** so runs do not hang; override with `TABSTACK_AUTOMATE_TIMEOUT_MS` (milliseconds; set to `0` for no cap). The Run button shows elapsed time while a request is in flight; for automate it also shows a **countdown to that cap** using `NEXT_PUBLIC_TABSTACK_AUTOMATE_TIMEOUT_MS` (defaults to 60s—set both env vars to the same value if you change the server cap).
- Vendor pricing and credit rules change; confirm current numbers in each dashboard/docs.
- Cached or rate-limited responses can skew latency and measured Firecrawl credits.
