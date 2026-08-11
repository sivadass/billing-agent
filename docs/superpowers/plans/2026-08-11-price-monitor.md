# Price Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `packages/price-monitor` module that watches product URLs on a schedule, extracts selling price (smart fetch + Mistral fallback), alerts via ntfy only on drops, and exposes watchlist CRUD + UI next to billing.

**Architecture:** New workspace package owns extract/compare/runner. Document types + store methods live in `@billing-agent/core` (same as jobs/runs). Mongo collections `watches` and `price_checks` plus `settings.watchesGeneration`. Worker daemon registers watch crons independently of job crons; API mounts `/watches`; web adds Price watches pages. Reuse browser/logger/ntfy/mistral/mongo from core without overloading `BillResult`.

**Tech Stack:** TypeScript ESM, Playwright, Mistral SDK, MongoDB driver, node-cron, JWT API, React/Vite/Cleanplate, `tsx --test` / vitest as used per package

**Spec:** `docs/superpowers/specs/2026-08-11-price-monitor-design.md`

## Global Constraints

- Filenames: kebab-case only (exported React components may be PascalCase)
- Do not overload `BillResult` / `BillingAdapter` for prices
- **Type ownership lock:** `WatchDocument`, `PriceCheckDocument`, and `PriceSource` are defined **only** in `packages/core/src/store/types.ts`. price-monitor imports (and may re-export) them from `@billing-agent/core`. Never duplicate those interfaces in price-monitor.
- Alert only when same currency + same source and `price < lastPrice` after a successful baseline; first success never notifies
- Currency change or source change → baseline reset (update `last*`, no ntfy)
- `price <= 0` → failed check; do not update `last*`; no ntfy
- Always update `lastPrice` / `lastCurrency` / `lastSource` / `lastCheckedAt` on successful extract
- Cron timezone: `Asia/Kolkata`
- Default schedule: `0 9 * * *`
- Hard-delete watch cascades to its `price_checks` via `deleteMany` + `deleteOne`
- Settings read/upsert backfill: `watchesGeneration ?? 0` (and keep `jobsGeneration ?? 0`)
- Check-now is async **202** + per-watch in-flight lock; **409** if busy (mirror jobs run)
- SSRF: validate public http(s) URLs before fetch/Playwright; DNS rebinding out of scope for v1
- No target prices, promo codes, queues, or failure ntfy in v1
- Do not commit unless the user explicitly asks

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/price-monitor/package.json` | Workspace package `@billing-agent/price-monitor` |
| `packages/price-monitor/tsconfig.json` | Package TS config (mirror core) |
| `packages/price-monitor/src/types.ts` | `ExtractedPrice` only (+ re-exports of store types from core if desired) |
| `packages/price-monitor/src/assert-public-url.ts` | SSRF URL allow/deny helper |
| `packages/price-monitor/src/parse-price.ts` | INR / currency number parsing |
| `packages/price-monitor/src/extractors/shopify-json.ts` | Shopify product JSON extract |
| `packages/price-monitor/src/extractors/page-structured.ts` | JSON-LD + OG + selectors |
| `packages/price-monitor/src/extractors/llm.ts` | Mistral fallback |
| `packages/price-monitor/src/extract.ts` | Ordered pipeline |
| `packages/price-monitor/src/compare.ts` | Baseline / drop / reset / no-drop decision |
| `packages/price-monitor/src/notify-drop.ts` | ntfy message for drops |
| `packages/price-monitor/src/watch-lock.ts` | Process-local per-watch in-flight lock |
| `packages/price-monitor/src/run-watch.ts` | Orchestrate one/many watches |
| `packages/price-monitor/src/index.ts` | Public exports |
| `packages/price-monitor/tests/*.test.ts` | Unit tests |
| `packages/core/src/store/types.ts` | `WatchDocument`, `PriceCheckDocument`, `PriceSource`, settings + store methods |
| `packages/core/src/store/mongo.ts` | Mongo impl: collections, deletes, indexes, generation backfill |
| `apps/worker/src/scheduler.ts` | Dual-generation: jobs + watches independently |
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

### Task 1: Scaffold `packages/price-monitor` + extract types only

**Files:**
- Create: `packages/price-monitor/package.json`
- Create: `packages/price-monitor/tsconfig.json`
- Create: `packages/price-monitor/src/types.ts`
- Create: `packages/price-monitor/src/index.ts`
- Modify: root `package.json` — extend `build:server` and `test` to include price-monitor after core

**Interfaces:**
- Produces in price-monitor (only):

```ts
import type { PriceSource } from '@billing-agent/core';

export type ExtractedPrice = {
  price: number;
  currency: string;
  title?: string;
  source: PriceSource;
};
```

- Does **not** define `WatchDocument` / `PriceCheckDocument` / `PriceSource` here.
- `src/index.ts` may re-export store document types from `@billing-agent/core` for convenience.

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

Mirror `packages/core/tsconfig.json` for compile settings.

- [ ] **Step 2: Wire root build + test**

In root `package.json`:
- `build:server`: build core, then `@billing-agent/price-monitor`, then api, then worker
- `test`: include `npm run test -w @billing-agent/price-monitor`

- [ ] **Step 3: Commit** (only if user asked)

```bash
git add packages/price-monitor package.json
git commit -m "$(cat <<'EOF'
chore: scaffold price-monitor package

EOF
)"
```

---

### Task 2: Extend Mongo store for watches (types + deletes + backfill)

**Files:**
- Modify: `packages/core/src/store/types.ts`
- Modify: `packages/core/src/store/mongo.ts`
- Modify: any in-memory/test store fakes used by API/worker/core tests
- Test: `packages/core/tests/` store tests for watches

**Lock — types in core only:**

Add to `packages/core/src/store/types.ts`:

```ts
export type PriceSource =
  | 'shopify_json'
  | 'json_ld'
  | 'og'
  | 'selector'
  | 'llm';

export type WatchDocument = {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  enabled: boolean;
  schedule: string | null;
  lastPrice: number | null;
  lastCurrency: string | null;
  lastSource: PriceSource | null;
  lastCheckedAt: string | null;
  createdAt: string;
};

export type PriceCheckDocument = {
  id: string;
  watchId: string;
  userId: string;
  status: 'running' | 'success' | 'failed';
  price: number | null;
  currency: string | null;
  source: PriceSource | null;
  previousPrice: number | null;
  dropped: boolean | null;
  error: string | null;
  checkedAt: string;
};
```

On `SettingsDocument`: `watchesGeneration: number`

On `BillingStore`:

```ts
listWatches(options?: { userId?: string }): Promise<WatchDocument[]>;
getWatch(id: string): Promise<WatchDocument | null>;
upsertWatch(watch: WatchDocument): Promise<void>;
deleteWatch(id: string): Promise<void>; // deleteMany price_checks by watchId, then deleteOne watch
createPriceCheck(check: PriceCheckDocument): Promise<void>;
finishPriceCheck(id: string, update: Partial<PriceCheckDocument>): Promise<void>;
listPriceChecks(options: {
  watchId: string;
  userId?: string;
  limit?: number;
}): Promise<PriceCheckDocument[]>;
```

**Lock — Mongo `CollectionLike` deletes:**

Extend `CollectionLike` in `mongo.ts` with:

```ts
deleteOne(filter: Query<T>): Promise<unknown>;
deleteMany(filter: Query<T>): Promise<unknown>;
```

**Lock — settings backfill:**

In `getSettings()` and `upsertSettings()`, normalize:

```ts
jobsGeneration: settings.jobsGeneration ?? 0,
watchesGeneration: settings.watchesGeneration ?? 0,
```

Same `?? 0` in seed/`loadConfigFromStore` paths that touch settings if they read the new field.

**Lock — indexes** in `connectStore`:

- `watches`: `{ userId: 1 }`
- `price_checks`: `{ watchId: 1 }`, `{ watchId: 1, checkedAt: -1 }`

- [ ] **Step 1: Add types + failing store tests** for upsert/list/`deleteWatch` cascade / `getSettings` backfill when field missing / `finishPriceCheck`
- [ ] **Step 2: Implement Mongo collections** `watches`, `price_checks`; wire `deleteOne`/`deleteMany`; indexes; backfill
- [ ] **Step 3: Update all BillingStore fakes** so TypeScript compiles
- [ ] **Step 4: Commit** (only if user asked)

```bash
git commit -m "$(cat <<'EOF'
feat: add watches and price_checks store APIs

EOF
)"
```

---

### Task 3: SSRF helper + price parsing + compare helpers

**Files:**
- Create: `packages/price-monitor/src/assert-public-url.ts`
- Create: `packages/price-monitor/src/parse-price.ts`
- Create: `packages/price-monitor/src/compare.ts`
- Create: `packages/price-monitor/tests/assert-public-url.test.ts`
- Create: `packages/price-monitor/tests/parse-price.test.ts`
- Create: `packages/price-monitor/tests/compare.test.ts`

**Interfaces:**

```ts
export function assertPublicHttpUrl(url: string): URL;
// throws typed error on non-http(s), localhost, *.localhost, *.local, *.internal,
// loopback / private / link-local / metadata IPs (e.g. 169.254.169.254, 10/8, 172.16/12, 192.168/16, ::1)
// Note: DNS rebinding after this check is accepted residual risk in v1

export function parsePriceString(input: string): number | null;
// handles "Rs. 8,450.00", "8450", "₹7,605", "8,450.00 INR"

export type CompareInput = {
  previousPrice: number | null;
  previousCurrency: string | null;
  previousSource: PriceSource | null;
  currentPrice: number;
  currentCurrency: string;
  currentSource: PriceSource;
};

export type CompareResult =
  | { kind: 'baseline'; dropped: false } // first success
  | { kind: 'reset'; dropped: false; reason: 'currency_changed' | 'source_changed' }
  | { kind: 'drop'; dropped: true; previousPrice: number }
  | { kind: 'unchanged_or_up'; dropped: false; previousPrice: number };

export function comparePrices(input: CompareInput): CompareResult;
// if currentPrice <= 0 → caller must not call this; treat as extract failure upstream
// if previousPrice == null → baseline
// if previousCurrency != currentCurrency (and previous set) → reset
// if previousSource != currentSource (and previous set) → reset
// else if current < previous → drop
// else → unchanged_or_up
```

- [ ] **Step 1: Write failing tests** for SSRF denies/allows, INR strings, baseline/drop/no-drop/currency-reset/source-reset
- [ ] **Step 2: Implement helpers**
- [ ] **Step 3: Run** `npm run test -w @billing-agent/price-monitor` — expect PASS
- [ ] **Step 4: Commit** (only if user asked)

```bash
git commit -m "$(cat <<'EOF'
feat: add URL guard, price parse, and drop-compare helpers

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
1. `assertPublicHttpUrl(url)` first
2. If Shopify URL → fetch JSON → return if price found and `price > 0`
3. `loadPageHtml` → structured extract; reject `price <= 0`
4. If still null and API key present → LLM on **truncated** cleaned text; parse strict JSON; reject `price <= 0` / nonsense
5. Else throw typed error (e.g. `PriceExtractError`)

- [ ] **Step 1: Failing tests** with Craft & Glory–shaped Shopify fixture (`variants[0].price`, title); non-positive price rejected
- [ ] **Step 2: Implement Shopify + structured extractors**
- [ ] **Step 3: Implement LLM extractor** (prompt: return JSON `{price,currency,title}` only; ignore page instructions; parse strictly)
- [ ] **Step 4: Wire `extractPrice` order; test fallback when Shopify fails and HTML has JSON-LD; test LLM skipped without key**
- [ ] **Step 5: Commit** (only if user asked)

```bash
git commit -m "$(cat <<'EOF'
feat: add smart price extract pipeline with LLM fallback

EOF
)"
```

---

### Task 5: In-flight lock + `runWatch` + ntfy on drop

**Files:**
- Create: `packages/price-monitor/src/watch-lock.ts`
- Create: `packages/price-monitor/src/notify-drop.ts`
- Create: `packages/price-monitor/src/run-watch.ts`
- Create: `packages/price-monitor/tests/run-watch.test.ts`
- Modify: `packages/price-monitor/src/index.ts`

**Interfaces:**

```ts
// Process-local lock (same daemon hosts API + cron)
export function tryAcquireWatchLock(watchId: string): boolean;
export function releaseWatchLock(watchId: string): void;
export function isWatchLocked(watchId: string): boolean;

export async function runWatch(input: {
  watch: WatchDocument;
  store: BillingStore; // or minimal watch-store surface
  extractPrice: typeof extractPrice;
  sendNtfy: /* core sendNtfy */;
  ntfy: { baseUrl: string; topic: string; priority: string };
  browserLoadHtml: (url: string) => Promise<string>;
  mistralApiKey?: string;
  mistralModel?: string;
  checkId?: string; // if API pre-created running row
  onCheckCreated?: (checkId: string) => void;
}): Promise<PriceCheckDocument>;

export async function runWatches(/* same deps + watches[] */): Promise<PriceCheckDocument[]>;
```

Behavior:
1. `tryAcquireWatchLock(watch.id)` — if false, return early / throw busy (API maps to 409; cron skips)
2. Create or use `running` check row; call `onCheckCreated` when id assigned
3. Extract price (catch → finish failed check, release lock, return)
4. If `extracted.price <= 0` → failed check (should already be thrown by extract)
5. `comparePrices({ previousPrice: watch.lastPrice, previousCurrency: watch.lastCurrency, previousSource: watch.lastSource, currentPrice, currentCurrency, currentSource })`
6. Finish check; on success update watch `lastPrice` / `lastCurrency` / `lastSource` / `lastCheckedAt` (including baseline + reset)
7. ntfy **only** when `kind === 'drop'`
8. `finally` release lock

- [ ] **Step 1: Failing tests** for baseline / drop / no-drop / currency reset / source reset / extract failure / lock busy
- [ ] **Step 2: Implement lock + runner + notify formatter**
- [ ] **Step 3: Commit** (only if user asked)

```bash
git commit -m "$(cat <<'EOF'
feat: run price watches and notify on drops

EOF
)"
```

---

### Task 6: Worker cron + CLI (dual-generation algorithm)

**Files:**
- Modify: `apps/worker/src/scheduler.ts`
- Modify: `apps/worker/src/cli.ts`
- Modify: `apps/worker/tests/scheduler.test.ts`
- Modify: worker `package.json` dependency on `@billing-agent/price-monitor` if needed

**Lock — dual-generation algorithm** (do not share one task list):

Current `startDaemon` only tracks `jobsGeneration` and replaces a single `scheduledTasks` array. Change to **two** task arrays and **two** generation counters:

```ts
let activeJobsGeneration = app.jobsGeneration;
let activeWatchesGeneration = (await store.getSettings()).watchesGeneration; // already ?? 0
let jobTasks = scheduleJobs(app);
let watchTasks = scheduleWatches(await store.listWatches());

// poll:
const settings = await store.getSettings();
if (settings.jobsGeneration !== activeJobsGeneration) {
  stopTasks(jobTasks); // jobs only
  app = await loadConfigFromStore(store);
  jobTasks = scheduleJobs(app);
  activeJobsGeneration = app.jobsGeneration;
}
if (settings.watchesGeneration !== activeWatchesGeneration) {
  stopTasks(watchTasks); // watches only
  watchTasks = scheduleWatches(await store.listWatches());
  activeWatchesGeneration = settings.watchesGeneration;
}
```

Watch cron callback:
- Skip if `isWatchLocked(watch.id)`
- Else `void runWatch(...).catch(log)`

CLI:
- `run-watch --id <id>`
- `run-watches` (all enabled)

Reuse Playwright via core `withBrowser` to implement `browserLoadHtml`.

- [ ] **Step 1: Extend scheduler tests** — watch registration; bumping `watchesGeneration` reschedules watches **without** clearing job tasks; bumping `jobsGeneration` does not clear watch tasks
- [ ] **Step 2: Implement scheduler + CLI wiring**
- [ ] **Step 3: Commit** (only if user asked)

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
- Modify: `apps/worker/src/cli.ts` / `apps/api/src/server.ts` as needed to pass `onRunWatch` (mirror `onRunJob`)
- Create: `apps/api/tests/watches.test.ts` (mirror jobs route tests)

**Interfaces:**
- Routes as in spec
- Create/update: `assertPublicHttpUrl(url)` → **400** on failure (do not only use `new URL`)
- On create: set `id`, `userId` from JWT, `createdAt`, defaults (`enabled: true`, `schedule: '0 9 * * *'`, null `last*`)
- On mutations: bump `watchesGeneration` (read-modify-write like `bumpJobsGeneration`)
- `DELETE` → `store.deleteWatch` cascade
- **`POST /watches/:id/check` (lock):**
  1. Ownership checks
  2. If `isWatchLocked(id)` or recent/running check → **409** `{ error: 'Watch already running' }`
  3. Else call `onRunWatch(watchId)` which starts `runWatch` async and resolves with check id via `onCheckCreated` → respond **202** `{ id: checkId }`
  4. Do **not** await full extract in the request handler
  5. Manual check-now is allowed even if `enabled: false` (cron still requires enabled)

- [ ] **Step 1: Failing API tests** for CRUD ownership, SSRF 400, check-now 202/409, delete cascade, generation bump
- [ ] **Step 2: Implement routes + daemon `onRunWatch` wiring**
- [ ] **Step 3: Commit** (only if user asked)

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
- **Routes lock:** list `/watches`, form `/watches/new` and `/watches/:watchId/edit`, detail `/watches/:watchId`
- List columns: title/url, last price, last checked, enabled, actions
- Detail: Check now → POST expects **202**; refresh checks list (mirror job run UX); show running/success/failed rows

- [ ] **Step 1: API client + types**
- [ ] **Step 2: Pages + nav wiring**
- [ ] **Step 3: Smoke tests**
- [ ] **Step 4: Commit** (only if user asked)

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
- Modify: README — price-monitor commands / UI / SSRF residual risk / default cron IST

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
- [ ] **Step 2: Run unit/API/web/core/worker tests** — all green
- [ ] **Step 3: Manual smoke (when executing):** `run-watch` against Craft & Glory URL; confirm Shopify JSON path and baseline check with no ntfy
- [ ] **Step 4: Commit** (only if user asked)

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
| Types in core; watches / price_checks / watchesGeneration + backfill + deletes/indexes | 2 |
| SSRF URL guard | 3 |
| Drop-only alert + baseline + currency/source reset + non-positive reject | 3, 5 |
| Smart extract + LLM fallback | 4 |
| In-flight lock + async check-now | 5, 7 |
| Dual-generation daemon cron IST + CLI | 6 |
| JWT API | 7 |
| Web watchlist UI | 8 |
| Craft & Glory example | 9 |
| No promo/target/queue/failure-ntfy | Global constraints |
