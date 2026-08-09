# Agentic Overlay Learning Design

**Date:** 2026-08-08  
**Status:** Approved  
**Stack:** Node.js workspaces, TypeScript, Playwright, Mistral, MongoDB Atlas, ntfy.sh

## Problem

The billing agent already works as deterministic automation (named adapters + Playwright + ntfy). Portal UI changes break selectors and force manual code edits. We want budget-friendly “agentic” recovery that learns durable selector overlays, plus a small HTTP API and monorepo layout so a UI and dynamic jobs can come later.

## Goals

- Keep the happy path scripted and cheap (no recovery LLM when adapters succeed)
- On recoverable failure: one Mistral call proposing a validated selector overlay, one retry
- Persist learned overlays in MongoDB; auto-activate after **3** matching successful recoveries
- Store jobs and settings in MongoDB (secrets remain env vars)
- Persist every job **run** for status/history
- Token-protected HTTP API for runs + job CRUD (UI later)
- Reorganize into npm workspaces: `packages/core`, `apps/worker`, `apps/api`, `apps/web` stub
- Coolify: one container (`worker daemon` = scheduler + embedded API)

## Non-goals

- Full browser-driving LLM agent every run
- Cursor SDK runtime
- Human approval gate before activating overlays
- Rewriting adapter TypeScript from the agent
- Bill payment or any mutating portal actions beyond login/scrape
- Building the web UI (stub README only)
- Live Atlas or live TNPDCL in CI

## Decisions

| Topic | Decision |
| --- | --- |
| Agentic shape | Recovery-only (option B); not a browser-driving agent |
| Learning | After 3 matching successful recoveries → auto-activate overlay |
| Approval | Auto-activate (no ntfy approve step) |
| Overlay storage | MongoDB `learned_overlays` |
| Job config | MongoDB `jobs` + `settings`; `.env` for secrets + `MONGODB_URI` + `API_TOKEN` |
| Persistence of runs | MongoDB `runs` |
| HTTP | Token-protected API in this slice; UI later |
| Layout | npm workspaces monorepo |
| Deploy | Single Coolify process embeds API inside worker daemon |

## Monorepo layout

```text
billing-agent/
  package.json                 # workspaces root
  apps/
    worker/                    # @billing-agent/worker — run | seed-jobs | daemon
    api/                       # @billing-agent/api — HTTP server
    web/                       # Future UI — stub README only
  packages/
    core/                      # @billing-agent/core — store, adapters, runner, recovery, …
  fixtures/
  docs/
  Dockerfile                   # CMD: worker daemon
```

**Import rules**

- `apps/*` may depend on `@billing-agent/core`
- `core` must not import `apps/*`
- `api` uses core store/types for CRUD/reads; Playwright execution stays in core/worker

## Architecture

```text
cron / worker daemon
        │
        ├── scheduler ──► core job-runner ──► adapters (+ optional overlay)
        │                      │
        │                      ├── recovery (Mistral, once) on failure
        │                      └── runs collection (start/finish)
        │
        └── apps/api (in-process) ──► jobs / runs (MongoDB)
                 ▲
                 └── future apps/web (Bearer token)
```

### Happy path

1. Load job + active overlay from MongoDB  
2. Run adapter with overlay applied  
3. Write `runs` success; ntfy if configured  
4. No recovery LLM

### Failure / learning path

1. Recoverable error (`LoginError` | `ScrapeError` | `TimeoutError`)  
2. Fingerprint = hash(error code + failed step hint + URL path/title)  
3. One Mistral call: error message + screenshot + compact DOM (labels/ids/inputs only)  
4. Response must be schema-validated JSON patch (allowed keys only); reject free-form code  
5. Retry adapter **once** with candidate overlay  
6. On retry success: upsert candidate, `successCount++`; if `>= 3` → `status: active`, retire prior active for that fingerprint family  
7. On retry fail or invalid patch: ntfy failure as today; no count bump  
8. Do **not** recover `ConfigError`, `NotifyError`, or `CaptchaError` (captcha has its own retry)

## Data model (MongoDB)

Database name example: `billing_agent`.

### `jobs`

```json
{
  "id": "home-eb",
  "provider": "tnpdcl",
  "enabled": true,
  "schedule": "0 9 * * *",
  "credentialsEnv": {
    "username": "TNPDCL_USERNAME",
    "password": "TNPDCL_PASSWORD"
  },
  "notify": { "title": "TNPDCL Bill" }
}
```

### `settings` (single document)

Non-secret app defaults: ntfy `baseUrl` / `priority` / `topicEnv`, mistral `model` / `apiKeyEnv`, browser flags. Secret **values** stay in environment.

### `learned_overlays`

```json
{
  "provider": "tnpdcl",
  "jobId": "home-eb",
  "fingerprint": "…",
  "patch": { "username": "#userName", "amountPatterns": ["…"] },
  "successCount": 3,
  "status": "active",
  "updatedAt": "2026-08-08T00:00:00.000Z"
}
```

`status`: `candidate` | `active` | `retired`.

### `runs`

```json
{
  "id": "…",
  "jobId": "home-eb",
  "provider": "tnpdcl",
  "status": "success",
  "startedAt": "…",
  "finishedAt": "…",
  "durationMs": 12345,
  "errorCode": null,
  "errorMessage": null,
  "screenshotPath": null,
  "recoveryAttempted": false,
  "recoverySucceeded": false,
  "overlayActivated": false,
  "billSummary": { "amount": "₹100.00", "accountLabel": "****1234" }
}
```

## Overlay contract

Adapters accept optional `overlay` on context. Named keys override hardcoded selectors / field patterns (e.g. TNPDCL `username`, `password`, `captchaInput`, `loginButton`, amount/due-date patterns). Unknown keys rejected; patch size capped.

## HTTP API

Auth: `Authorization: Bearer $API_TOKEN` on all routes except `GET /health`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/runs` | List runs (`?jobId=&limit=`) |
| `GET` | `/runs/:id` | Run detail |
| `GET` | `/jobs` | List jobs |
| `GET` | `/jobs/:id` | One job |
| `POST` | `/jobs` | Create job (dynamic) |
| `PATCH` | `/jobs/:id` | Update job |
| `DELETE` | `/jobs/:id` | Soft-disable (`enabled: false`) |

After job mutations, scheduler reloads (generation counter or short poll) without process restart.

Env: `MONGODB_URI`, `API_TOKEN`, `HTTP_PORT` (default `8080`), plus existing ntfy/Mistral/provider secrets.

## CLI

- `seed-jobs --from <jobs.json>` — upsert jobs/settings into Mongo  
- `run --job <id> | --all` — one-shot (loads from Mongo)  
- `daemon` — scheduler + HTTP in one process  

Runtime source of truth is MongoDB after seed. File config is seed/export only; no silent fallback if Mongo is down (`ConfigError`).

## Error handling

| Case | Behavior |
| --- | --- |
| Mongo down / auth fail | `ConfigError`, fail fast |
| Invalid recovery JSON | Skip retry; normal failure path |
| Active overlay starts failing | New candidate can replace after 3 successes; no demotion on first fail |
| Missing `API_TOKEN` in daemon | Fail fast at HTTP start |

## Testing

- Mock Mongo store in unit tests (no live Atlas in CI)  
- Mock Mistral recovery → assert one retry + upsert + activate-at-3  
- Dummy adapter proves overlay override without LLM  
- HTTP: 401 without token; job CRUD happy path  
- After monorepo move: existing tests still green before new features

## Deploy (Coolify)

- Dockerfile builds workspaces; CMD worker daemon  
- Expose `HTTP_PORT`; healthcheck `GET /health`  
- Runtime env: `MONGODB_URI`, `API_TOKEN`, `NTFY_TOPIC`, `MISTRAL_API_KEY`, provider credentials  
- ≥1 GB RAM for Chromium spikes  

## Implementation order

See [implementation plan](../plans/2026-08-08-agentic-overlay-learning.md).
