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
- Variant / size-specific price picks
- Email / Slack channels (ntfy only)
- Separate deployables or message queues
- ntfy alerts on extract failures
- Multi-tenant self-serve registration changes

## Decisions

| Topic | Decision |
| --- | --- |
| Module layout | New workspace package `packages/price-monitor`; billing stays in `packages/core` |
| Host process | Same worker daemon + same API + same web app |
| Alert rule | First success = baseline (no notify). Later success with `price < lastPrice` → ntfy. Always update `lastPrice` on success |
| Extraction | Smart pipeline, then Mistral LLM fallback on failure |
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

1. **Shopify JSON** — if URL path matches `/products/<handle>`, `GET {origin}/products/<handle>.json`; use selling `price` (not promo copy)
2. **Playwright** — load product URL
3. **JSON-LD** — `Product` / `Offer` (`price`, `priceCurrency`)
4. **Open Graph / meta** — `product:price:amount`, `og:price:amount`, etc.
5. **Common selectors** — `[itemprop=price]` and a small allowlist; parse INR / `Rs.`
6. **Mistral LLM** — only if 1–5 fail; if `MISTRAL_API_KEY` missing, fail the check

Normalized output: `{ price: number, currency: string, title?: string, source }`.

### Shared reuse from `@billing-agent/core`

- Playwright browser helpers, logger, ntfy client, Mistral client config, Mongo connection
- Do **not** overload `BillResult` / `BillingAdapter` for prices

## Data model

### `watches`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable id |
| `userId` | string | Owner |
| `url` | string | Product page URL |
| `title` | string \| null | Optional; may fill from scrape |
| `enabled` | boolean | Cron only if true |
| `schedule` | string \| null | Cron expr; default `0 9 * * *` |
| `lastPrice` | number \| null | Last successful price |
| `lastCurrency` | string \| null | e.g. `INR` |
| `lastCheckedAt` | string \| null | ISO timestamp |
| `createdAt` | string | ISO timestamp |

### `price_checks`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `watchId` | string | |
| `userId` | string | |
| `status` | `success` \| `failed` | |
| `price` | number \| null | |
| `currency` | string \| null | |
| `source` | string \| null | `shopify_json` \| `json_ld` \| `og` \| `selector` \| `llm` |
| `previousPrice` | number \| null | |
| `dropped` | boolean \| null | true only when drop alert fired |
| `error` | string \| null | |
| `checkedAt` | string | ISO timestamp |

### Settings

Add `watchesGeneration: number` next to `jobsGeneration` so the daemon reloads watch cron tasks without restart.

### Delete behavior (v1)

Hard-delete a watch and cascade-delete its `price_checks`.

## API

JWT-protected:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/watches` | List current user’s watches |
| `POST` | `/watches` | Create watch |
| `GET` | `/watches/:id` | Get one |
| `PATCH` | `/watches/:id` | Update (url, title, enabled, schedule) |
| `DELETE` | `/watches/:id` | Hard delete + checks |
| `POST` | `/watches/:id/check` | Run check now |
| `GET` | `/watches/:id/checks` | Check history |

Mutations bump `watchesGeneration`.

## Worker

- Register enabled watches with `node-cron` and `{ timezone: 'Asia/Kolkata' }`
- Poll settings for `watchesGeneration` changes (same pattern as jobs)
- CLI: `run-watch --id <id>` and `run-watches`
- Sequential in-process execution

## Web UI

- Nav: **Price watches** alongside Jobs / Runs / Status
- List page: title/URL, last price, last checked, enabled, last status
- Form: create/edit URL, optional title, schedule, enabled
- Detail: recent checks + **Check now**
- Reuse Cleanplate + existing auth / api-client patterns; kebab-case filenames

## Error handling

- Extract/network failure → `price_checks` with `status: failed`; leave `lastPrice` unchanged; no ntfy
- Invalid URL on create → `400`
- LLM skipped when no API key → failed check with clear error

## Testing

- Unit: Shopify/JSON-LD/OG/selector parsers, INR parsing, baseline vs drop vs no-drop compare
- Mocked fetch + HTML fixtures; Mistral mocked
- API CRUD + check-now; web smoke tests matching existing vitest patterns

## Example seed (optional)

Craft & Glory product for Shopify JSON smoke:

`https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole`
