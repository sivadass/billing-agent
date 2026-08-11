# Price Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `packages/price-monitor` module that watches product URLs on a schedule, extracts selling price (smart fetch + Mistral fallback), alerts via ntfy only on drops, and exposes watchlist CRUD + UI next to billing.

**Architecture:** New workspace package owns extract/compare/runner types. Mongo collections `watches` and `price_checks` plus `settings.watchesGeneration`. Worker daemon registers watch crons; API mounts `/watches`; web adds Price watches pages. Reuse browser/logger/ntfy/mistral/mongo from `@billing-agent/core` without overloading `BillResult`.

**Tech Stack:** TypeScript ESM, Playwright, Mistral SDK, MongoDB driver, node-cron, JWT API, React/Vite/Cleanplate, `tsx --test` / vitest as used per package

**Spec:** `docs/superpowers/specs/2026-08-11-price-monitor-design.md`

## Global Constraints

- Filenames: kebab-case only (exported React components may be PascalCase)
- Do not overload `BillResult` / `BillingAdapter` for prices
- Alert only when `price < lastPrice` after a successful baseline; first success never notifies
- Always update `lastPrice` / `lastCurrency` / `lastCheckedAt` on successful extract
- Cron timezone: `Asia/Kolkata`
- Default schedule: `0 9 * * *`
- Hard-delete watch cascades to its `price_checks`
- No target prices, promo codes, queues, or failure ntfy in v1
- Do not commit unless the user explicitly asks

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/price-monitor/package.json` | Workspace package `@billing-agent/price-monitor` |
| `packages/price-monitor/tsconfig.json` | Package TS config (mirror core) |
| `packages/price-monitor/src/types.ts` | `WatchDocument`, `PriceCheckDocument`, `ExtractedPrice` |
| `packages/price-monitor/src/parse-price.ts` | INR / currency number parsing |
| `packages/price-monitor/src/extractors/shopify-json.ts` | Shopify product JSON extract |
| `packages/price-monitor/src/extractors/page-structured.ts` | JSON-LD + OG + selectors on a Playwright page |
| `packages/price-monitor/src/extractors/llm.ts` | Mistral fallback |
| `packages/price-monitor/src/extract.ts` | Ordered pipeline |
| `packages/price-monitor/src/compare.ts` | Baseline / drop / no-drop decision |
| `packages/price-monitor/src/notify-drop.ts` | ntfy message for drops |
| `packages/price-monitor/src/run-watch.ts` | Orchestrate one/many watches |
| `packages/price-monitor/src/index.ts` | Public exports |
| `packages/price-monitor/tests/*.test.ts` | Unit tests |
| `packages/core/src/store/types.ts` | Extend settings + store interface for watches |
| `packages/core/src/store/mongo.ts` | Mongo impl for watches / checks / generation |
| `apps/worker/src/scheduler.ts` | Schedule watches + poll `watchesGeneration` |
| `apps/worker/src/cli.ts` | `run-watch` / `run-watches` |
| `apps/api/src/routes.ts` (or `watch-routes.ts`) | `/watches` HTTP |
| `apps/web/src/lib/watches-api.ts` | Client |
| `apps/web/src/lib/types.ts` | Frontend types |
| `apps/web/src/pages/watches-page.tsx` | List |
| `apps/web/src/pages/watch-form-page.tsx` | Create/edit |
| `apps/web/src/pages/watch-detail-page.tsx` | History + check now |
| `apps/web/src/app.tsx` | Nav + routes |
| `watches.example.json` | Optional seed example |

---

### Task 1: Scaffold `packages/price-monitor` + domain types

**Files:**
- Create: `packages/price-monitor/package.json`
- Create: `packages/price-monitor/tsconfig.json`
- Create: `packages/price-monitor/src/types.ts`
- Create: `packages/price-monitor/src/index.ts`
- Modify: root `package.json` workspaces already include `packages/*` — add build/test scripts if needed
- Modify: `package.json` `build:server` to build price-monitor

**Interfaces:**
- Produces:

```ts
export type PriceSource =
  | 'shopify_json'
  | 'json_ld'
  | 'og'
  | 'selector'
  | 'llm';

export type ExtractedPrice = {
  price: number;
  currency: string;
  title?: string;
  source: PriceSource;
};

export type WatchDocument = {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  enabled: boolean;
  schedule: string | null;
  lastPrice: number | null;
  lastCurrency: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
};

export type PriceCheckDocument = {
  id: string;
  watchId: string;
  userId: string;
  status: 'success' | 'failed';
  price: number | null;
  currency: string | null;
  source: PriceSource | null;
  previousPrice: number | null;
  dropped: boolean | null;
  error: string | null;
  checkedAt: string;
};
```

- [ ] **Step 1: Create package skeleton**

`packages/price-monitor/package.json`:

```json
{
  "name": "@billing-agent/price-monitor",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "cd ../.. && tsx --test packages/price-monitor/tests/**/*.test.ts"
  },
  "dependencies": {
    "@billing-agent/core": "0.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0"
  }
}
```

Mirror `packages/core/tsconfig.json` for compile settings. Export types from `src/index.ts`.

- [ ] **Step 2: Wire root build**

In root `package.json`, extend `build:server` to build `@billing-agent/price-monitor` after core.

- [ ] **Step 3: Commit**

```bash
git add packages/price-monitor package.json
git commit -m "$(cat <<'EOF'
chore: scaffold price-monitor package

EOF
)"
```

---

### Task 2: Extend Mongo store for watches

**Files:**
- Modify: `packages/core/src/store/types.ts`
- Modify: `packages/core/src/store/mongo.ts`
- Modify: any in-memory/test store fakes used by API/worker tests
- Test: `packages/core/tests/` (or price-monitor tests with fake store)

**Interfaces:**
- Produces on `SettingsDocument`: `watchesGeneration: number`
- Produces on `BillingStore` (or a dedicated `PriceMonitorStore` interface composed in apps):

```ts
listWatches(options?: { userId?: string }): Promise<WatchDocument[]>;
getWatch(id: string): Promise<WatchDocument | null>;
upsertWatch(watch: WatchDocument): Promise<void>;
deleteWatch(id: string): Promise<void>; // also deletes price_checks for watchId
createPriceCheck(check: PriceCheckDocument): Promise<void>;
listPriceChecks(options: {
  watchId: string;
  userId?: string;
  limit?: number;
}): Promise<PriceCheckDocument[]>;
```

Prefer extending `BillingStore` in core for one Mongo connection, while keeping watch document types imported from `@billing-agent/price-monitor` **or** duplicated thinly in core store types to avoid circular deps. **Chosen approach:** define watch/check document types in `packages/price-monitor/src/types.ts` and duplicate the store method signatures on an interface exported from price-monitor (`PriceWatchStore`) that mongo implements via a thin adapter in core or by extending `MongoBillingStore`. Simplest for this repo: add watch types + methods directly on `BillingStore` in core (same as jobs/runs), and re-export those types from price-monitor for the runner. Avoid circular imports: keep types in core store, or keep types in price-monitor and have core depend on price-monitor (undesirable). **Lock:** put `WatchDocument` / `PriceCheckDocument` in `packages/core/src/store/types.ts` next to jobs; price-monitor imports them from core for the runner.

- [ ] **Step 1: Add types + failing store tests** for upsert/list/delete cascade / generation bump helper
- [ ] **Step 2: Implement Mongo collections** `watches`, `price_checks`; default `watchesGeneration: 0` in settings seed/read path
- [ ] **Step 3: Update fakes** used by API tests
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add watches and price_checks store APIs

EOF
)"
```

---

### Task 3: Price parsing + compare helpers

**Files:**
- Create: `packages/price-monitor/src/parse-price.ts`
- Create: `packages/price-monitor/src/compare.ts`
- Create: `packages/price-monitor/tests/parse-price.test.ts`
- Create: `packages/price-monitor/tests/compare.test.ts`

**Interfaces:**
- Produces:

```ts
export function parsePriceString(input: string): number | null;
// handles "Rs. 8,450.00", "8450", "₹7,605", "8,450.00 INR"

export type CompareResult =
  | { kind: 'baseline'; dropped: false }
  | { kind: 'drop'; dropped: true; previousPrice: number }
  | { kind: 'unchanged_or_up'; dropped: false; previousPrice: number };

export function comparePrices(
  previous: number | null,
  current: number,
): CompareResult;
```

- [ ] **Step 1: Write failing tests** for INR strings and baseline/drop/no-drop
- [ ] **Step 2: Implement `parsePriceString` and `comparePrices`**
- [ ] **Step 3: Run** `npm run test -w @billing-agent/price-monitor` — expect PASS
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add price parse and drop-compare helpers

EOF
)"
```

---

### Task 4: Extractors + pipeline

**Files:**
- Create: `packages/price-monitor/src/extractors/shopify-json.ts`
- Create: `packages/price-monitor/src/extractors/page-structured.ts`
- Create: `packages/price-monitor/src/extractors/llm.ts`
- Create: `packages/price-monitor/src/extract.ts`
- Create: `packages/price-monitor/tests/shopify-json.test.ts`
- Create: `packages/price-monitor/tests/page-structured.test.ts`
- Create: `packages/price-monitor/tests/extract.test.ts`
- Create fixtures under `packages/price-monitor/tests/fixtures/` (sample Shopify JSON + HTML with JSON-LD)

**Interfaces:**
- Produces:

```ts
export function shopifyProductJsonUrl(productUrl: string): string | null;
export function extractFromShopifyJson(json: unknown): ExtractedPrice | null;

export function extractFromPageHtml(html: string): ExtractedPrice | null;
// JSON-LD then OG then selectors; source set accordingly

export async function extractWithLlm(input: {
  text: string;
  mistralApiKey: string;
  model: string;
}): Promise<ExtractedPrice | null>;

export async function extractPrice(input: {
  url: string;
  fetchJson?: typeof fetch;
  loadPageHtml: (url: string) => Promise<string>;
  mistralApiKey?: string;
  mistralModel?: string;
}): Promise<ExtractedPrice>;
```

Pipeline in `extractPrice`:
1. If Shopify URL → fetch JSON → return if price found
2. `loadPageHtml` → structured extract
3. If still null and API key present → LLM on cleaned text
4. Else throw typed error (e.g. `PriceExtractError`)

- [ ] **Step 1: Failing tests** with Craft & Glory–shaped Shopify fixture (`variants[0].price`, title)
- [ ] **Step 2: Implement Shopify + structured extractors**
- [ ] **Step 3: Implement LLM extractor** (prompt: return JSON `{price,currency,title}`; parse strictly)
- [ ] **Step 4: Wire `extractPrice` order; test fallback when Shopify fails and HTML has JSON-LD; test LLM skipped without key**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add smart price extract pipeline with LLM fallback

EOF
)"
```

---

### Task 5: `runWatch` + ntfy on drop

**Files:**
- Create: `packages/price-monitor/src/notify-drop.ts`
- Create: `packages/price-monitor/src/run-watch.ts`
- Create: `packages/price-monitor/tests/run-watch.test.ts`
- Modify: `packages/price-monitor/src/index.ts`

**Interfaces:**
- Consumes: store methods, `extractPrice`, `comparePrices`, core `sendNtfy`
- Produces:

```ts
export async function runWatch(input: {
  watch: WatchDocument;
  store: /* watch store */;
  extractPrice: typeof extractPrice;
  sendNtfy: /* core sendNtfy */;
  ntfy: { baseUrl: string; topic: string; priority: string };
  browserLoadHtml: (url: string) => Promise<string>;
  mistralApiKey?: string;
  mistralModel?: string;
}): Promise<PriceCheckDocument>;

export async function runWatches(/* same deps + watches[] */): Promise<PriceCheckDocument[]>;
```

Behavior:
1. Extract price (catch → failed check, return)
2. `comparePrices(watch.lastPrice, extracted.price)`
3. Persist check; on success update watch fields; if `dropped`, call ntfy with title, old→new, URL
4. Baseline: success check with `dropped: false`, no ntfy

- [ ] **Step 1: Failing tests** for baseline / drop / no-drop / extract failure
- [ ] **Step 2: Implement runner + notify formatter**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: run price watches and notify on drops

EOF
)"
```

---

### Task 6: Worker cron + CLI

**Files:**
- Modify: `apps/worker/src/scheduler.ts`
- Modify: `apps/worker/src/cli.ts`
- Modify: `apps/worker/tests/scheduler.test.ts`
- Modify: worker `package.json` dependency on `@billing-agent/price-monitor` if needed

**Interfaces:**
- Extend daemon to:
  - Load watches from store
  - `cron.schedule(expr, task, { timezone: 'Asia/Kolkata' })` for each enabled watch with schedule
  - Poll `watchesGeneration` like `jobsGeneration` and reschedule
- CLI commands:
  - `run-watch --id <id>`
  - `run-watches` (all enabled, or all for user if multi-user context matches jobs)

Reuse Playwright via core browser helper to implement `browserLoadHtml`.

- [ ] **Step 1: Extend scheduler tests** for watch registration + generation reload
- [ ] **Step 2: Implement scheduler + CLI wiring**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: schedule and CLI-run price watches

EOF
)"
```

---

### Task 7: API `/watches` routes

**Files:**
- Modify: `apps/api/src/routes.ts` (or create `apps/api/src/watch-routes.ts` and mount it)
- Create: `apps/api/tests/watches.test.ts` (mirror jobs route tests)

**Interfaces:**
- Routes as in spec; validate URL with `new URL(url)` and require `http:`/`https:`
- On create: set `id`, `userId` from JWT, `createdAt`, defaults (`enabled: true`, `schedule: '0 9 * * *'`, null prices)
- On mutations: bump `watchesGeneration`
- `POST /watches/:id/check` invokes `runWatch` and returns the check document
- `DELETE` cascade via store

- [ ] **Step 1: Failing API tests** for CRUD ownership, check-now, delete cascade
- [ ] **Step 2: Implement routes**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add JWT /watches API

EOF
)"
```

---

### Task 8: Web Price watches UI

**Files:**
- Create: `apps/web/src/lib/watches-api.ts`
- Modify: `apps/web/src/lib/types.ts`
- Create: `apps/web/src/pages/watches-page.tsx`
- Create: `apps/web/src/pages/watch-form-page.tsx`
- Create: `apps/web/src/pages/watch-detail-page.tsx`
- Modify: `apps/web/src/app.tsx`
- Create tests mirroring jobs pages where practical

**UI:**
- MENU item `{ label: 'Price watches', value: '/watches', icon: 'sell' }` (or similar Material icon already used by Cleanplate)
- Routes: `/watches`, `/watches/new`, `/watches/:watchId` (form), `/watches/:watchId/checks` or detail at `/watches/:watchId` with history — **lock:** list at `/watches`, form at `/watches/new` and `/watches/:watchId/edit`, detail at `/watches/:watchId`
- List columns: title/url, last price, last checked, enabled, actions
- Detail: Check now button, recent checks table

- [ ] **Step 1: API client + types**
- [ ] **Step 2: Pages + nav wiring**
- [ ] **Step 3: Smoke tests**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add Price watches UI

EOF
)"
```

---

### Task 9: Example seed + verification

**Files:**
- Create: `watches.example.json` (optional seed document shape)
- Modify: README briefly documenting price-monitor commands / UI

Example watch:

```json
{
  "id": "craft-glory-old-skool-vb",
  "url": "https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole",
  "title": "Old Skool Retro Leather Sneakers (Vintage Brown With White Sole)",
  "enabled": true,
  "schedule": "0 9 * * *"
}
```

- [ ] **Step 1: Add example JSON + README section**
- [ ] **Step 2: Run unit/API/web tests** — all green
- [ ] **Step 3: Manual smoke (when executing):** `run-watch` against Craft & Glory URL; confirm Shopify JSON path and baseline check with no ntfy
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: add price-monitor example watch and README notes

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Separate price-monitor package | 1 |
| watches / price_checks / watchesGeneration | 2 |
| Drop-only alert + baseline | 3, 5 |
| Smart extract + LLM fallback | 4 |
| Daemon cron IST + CLI | 6 |
| JWT API | 7 |
| Web watchlist UI | 8 |
| Craft & Glory example | 9 |
| No promo/target/queue/failure-ntfy | Global constraints |
