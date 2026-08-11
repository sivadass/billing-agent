# Price Monitor Module Design

**Date:** 2026-08-11  
**Status:** Approved for implementation  
**Stack:** Node.js, TypeScript, Playwright (Chromium), Mistral, ntfy.sh, MongoDB, React/Vite web

## Problem

Product prices on e-commerce sites (e.g. Craft & Glory Shopify storefronts) change with sales and offers. Manually rechecking pages is tedious. We need a scheduled watcher that checks product URLs daily and alerts only when the selling price drops.

## Goals

- New **price-monitor** module alongside the existing **billing** module in the same monorepo
- Watchlist of many product URLs with full CRUD UI
- Daily cron checks (default `0 9 * * *`, timezone `Asia/Kolkata`)
- Extract current selling price from arbitrary product URLs
- Notify via existing ntfy settings **only on price drop** (after a baseline first check)
- Persist check history for debugging and UI

## Non-goals (v1)

- Target-price thresholds (“alert if under ₹X”)
- Promo / coupon code tracking (e.g. `NEW10`)
- Variant / size-specific price picks (track default / first Shopify variant only)
- Email / Slack channels (ntfy only)
- Separate deployables or message queues
- ntfy alerts on extract failures
- Multi-tenant self-serve registration changes
- DNS-rebinding-proof SSRF hardening (block obvious private hosts; no resolve-then-connect race mitigation)

## Decisions

| Topic | Decision |
| --- | --- |
| Module layout | New workspace package `packages/price-monitor`; billing stays in `packages/core` |
| Document types ownership | `WatchDocument` / `PriceCheckDocument` / `PriceSource` live in `packages/core/src/store/types.ts` next to jobs/runs. `price-monitor` imports them from core and may re-export. Do **not** redefine them in price-monitor. |
| Host process | Same worker daemon + same API + same web app |
| Alert rule | First success = baseline (no notify). Later success with same currency + same source and `price < lastPrice` → ntfy. Always update `lastPrice` / `lastCurrency` / `lastSource` / `lastCheckedAt` on successful extract |
| Alert gates | `price <= 0` → failed check (no `last*` update, no ntfy). Currency change or source change → treat as **baseline reset** (update `last*`, `dropped: false`, no ntfy) |
| Extraction | Smart pipeline, then Mistral LLM fallback on failure |
| Check-now | Async like jobs: `202` + check id; process-local per-watch in-flight lock shared by cron and API (409 if busy) |
| Auth | Existing JWT user auth; watches owned by `userId` |
| Filenames | kebab-case only |

## Architecture

```text
Web (Price watches) ──► API /watches ──► packages/price-monitor
                                              │
Worker daemon cron ───────────────────────────┤
                                              ▼
                         extract → compare → Mongo + ntfy(on drop)
```

### Extraction order (per check)

1. **Shopify JSON** — if URL path matches `/products/<handle>`, `GET {origin}/products/<handle>.json`; use selling `price` (not promo / compare-at)
2. **Playwright** — load product URL
3. **JSON-LD** — `Product` / `Offer` (`price`, `priceCurrency`)
4. **Open Graph / meta** — `product:price:amount`, `og:price:amount`, etc.
5. **Common selectors** — `[itemprop=price]` and a small allowlist; parse INR / `Rs.`
6. **Mistral LLM** — only if 1–5 fail; if `MISTRAL_API_KEY` missing, fail the check

Normalized output: `{ price: number, currency: string, title?: string, source }`.

Reject non-positive prices before compare (extract failure).

### Shared reuse from `@billing-agent/core`

- Playwright browser helpers, logger, ntfy client, Mistral client config, Mongo connection
- Do **not** overload `BillResult` / `BillingAdapter` for prices

### URL safety (SSRF)

User-supplied watch URLs are fetched (Shopify `.json`) and opened in Playwright. Before any network I/O:

- Accept only `http:` / `https:`
- Reject credentials in URL, and reject non-default risky forms as needed
- Reject hostnames: `localhost`, `*.localhost`, and literal IPv4/IPv6 in private, loopback, link-local, and cloud metadata ranges (including `169.254.169.254`)
- Reject hostnames that are clearly internal (e.g. end with `.local`, `.internal`)

**Residual risk (accepted in v1):** DNS rebinding after validation is not mitigated. Document in README.

## Data model

### Type ownership

`WatchDocument`, `PriceCheckDocument`, and `PriceSource` are defined **only** in `@billing-agent/core` store types (same file as `JobDocument` / `RunDocument`). `@billing-agent/price-monitor` depends on core and imports these types. Extract-only types (`ExtractedPrice`) may live in price-monitor.

### `watches`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable id |
| `userId` | string | Owner |
| `url` | string | Product page URL (public http(s) only) |
| `title` | string \| null | Optional; may fill from scrape |
| `enabled` | boolean | Cron only if true |
| `schedule` | string \| null | Cron expr; default `0 9 * * *` |
| `lastPrice` | number \| null | Last successful price |
| `lastCurrency` | string \| null | e.g. `INR` |
| `lastSource` | `PriceSource` \| null | Last successful extract source |
| `lastCheckedAt` | string \| null | ISO timestamp |
| `createdAt` | string | ISO timestamp |

### `price_checks`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `watchId` | string | |
| `userId` | string | |
| `status` | `running` \| `success` \| `failed` | `running` while check-now / cron in flight |
| `price` | number \| null | |
| `currency` | string \| null | |
| `source` | `PriceSource` \| null | `shopify_json` \| `json_ld` \| `og` \| `selector` \| `llm` |
| `previousPrice` | number \| null | |
| `dropped` | boolean \| null | true only when drop alert fired |
| `error` | string \| null | |
| `checkedAt` | string | ISO timestamp (created / finished) |

### Settings

Add `watchesGeneration: number` next to `jobsGeneration`.

**Read/upsert backfill:** every settings read and upsert path must normalize `watchesGeneration ?? 0` (and keep existing `jobsGeneration ?? 0` behavior) so older Mongo settings docs without the field do not break the daemon.

### Indexes

- `watches`: `{ userId: 1 }`
- `price_checks`: `{ watchId: 1 }`, `{ watchId: 1, checkedAt: -1 }`

### Delete behavior (v1)

Hard-delete a watch and cascade-delete its `price_checks` (`deleteMany({ watchId })` then `deleteOne` watch). Mongo store `CollectionLike` must expose `deleteOne` / `deleteMany`.

## API

JWT-protected:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/watches` | List current user’s watches |
| `POST` | `/watches` | Create watch |
| `GET` | `/watches/:id` | Get one |
| `PATCH` | `/watches/:id` | Update (url, title, enabled, schedule) |
| `DELETE` | `/watches/:id` | Hard delete + checks |
| `POST` | `/watches/:id/check` | Run check now (async) |
| `GET` | `/watches/:id/checks` | Check history |

Mutations bump `watchesGeneration`.

### Check-now semantics (lock)

Mirror jobs’ `/jobs/:id/run`:

1. Process-local in-flight set keyed by `watchId` (same Node process hosts API + cron).
2. If watch already in-flight → **409** `{ error: 'Watch already running' }`.
3. Else create `price_checks` row with `status: 'running'`, return **202** `{ id: checkId }`, finish extract/compare/notify asynchronously, then set `success` / `failed`.
4. Cron callbacks use the same in-flight lock; if busy, skip this tick (log + no second check).

Do **not** hold the HTTP response open for Playwright.

### Create/update URL validation

Apply SSRF policy above; invalid → **400**.

## Worker

### Dual-generation scheduler (lock)

Jobs and watches are scheduled independently. Reloading one must not tear down the other.

```text
activeJobsGeneration     = app.jobsGeneration
activeWatchesGeneration  = settings.watchesGeneration ?? 0
jobTasks                 = scheduleJobs(app)
watchTasks               = scheduleWatches(store.listWatches())

poll every pollIntervalMs:
  settings = store.getSettings()   // already backfills ?? 0
  if settings.jobsGeneration !== activeJobsGeneration:
    stop(jobTasks only)
    app = loadConfigFromStore(store)
    jobTasks = scheduleJobs(app)
    activeJobsGeneration = app.jobsGeneration
  if settings.watchesGeneration !== activeWatchesGeneration:
    stop(watchTasks only)
    watches = store.listWatches()
    watchTasks = scheduleWatches(watches)
    activeWatchesGeneration = settings.watchesGeneration
```

- Register enabled watches with `node-cron` and `{ timezone: 'Asia/Kolkata' }`
- CLI: `run-watch --id <id>` and `run-watches`
- Sequential in-process execution; respect per-watch in-flight lock

## Web UI

- Nav: **Price watches** alongside Jobs / Runs / Status
- List page: title/URL, last price, last checked, enabled, last status
- Form: create/edit URL, optional title, schedule, enabled
- Detail: recent checks + **Check now** (POST → 202, then refresh checks list — same UX pattern as job run)
- Reuse Cleanplate + existing auth / api-client patterns; kebab-case filenames

## Error handling

- Extract/network failure → finish check `status: failed`; leave `last*` unchanged; no ntfy
- `price <= 0` → failed check with clear error
- Invalid / non-public URL on create/update → `400`
- LLM skipped when no API key → failed check with clear error
- In-flight conflict → `409` on check-now; cron skip

## Testing

- Unit: Shopify/JSON-LD/OG/selector parsers, INR parsing, baseline vs drop vs no-drop vs currency/source reset vs non-positive reject
- SSRF URL helper unit tests (localhost, private IP, metadata IP, happy path)
- Mocked fetch + HTML fixtures; Mistral mocked
- Store: delete cascade + `watchesGeneration` backfill on read
- Scheduler: jobs reload does not clear watch tasks and vice versa
- API CRUD + check-now 202/409; web smoke tests matching existing vitest patterns

## Example seed (optional)

Craft & Glory product for Shopify JSON smoke:

`https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole`
