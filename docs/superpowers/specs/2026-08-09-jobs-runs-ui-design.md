# Jobs & Runs Operator UI Design

**Date:** 2026-08-09  
**Status:** Approved for implementation planning  
**Related:** `2026-08-09-web-api-shell-design.md`, `2026-08-08-agentic-overlay-learning-design.md`, `apps/web`, `apps/api`, `apps/worker`

## Problem

Operators can call the HTTP API (and use the web TokenGate + status shell), but there is no browser UI to list jobs, create/edit them, soft-disable them, browse run history, or trigger a manual run with live status.

## Goals

- Jobs hub: list, create, edit, enable/disable (soft-delete), Run now
- Runs hub: filterable history table + shareable run detail with live polling
- Status hub: keep existing health/auth probes
- React Router with bookmarkable URLs
- Credentials remain **env var names only** (no secret values in UI/API payloads)
- Schedule displayed in human-friendly English; edited as raw cron (empty/null = manual only)
- Async Run now via new API endpoint wired from the worker daemon

## Non-goals

- Hard delete of jobs
- Storing or editing secret credential values in the UI
- WebSockets / SSE (polling only)
- Overlay management UI
- Settings / ntfy / mistral / browser config UI
- Live screenshot image viewing
- Multi-user auth beyond existing Bearer token

## Decisions

| Topic | Decision |
| --- | --- |
| Product shape | Equal hubs: Jobs \| Runs \| Status (Approach 2) |
| Navigation | `react-router-dom`; `/` redirects to `/jobs` |
| Jobs list layout | Dense Cleanplate `Table` with row actions |
| Runs list layout | Full table + filters; row navigates to detail (no drawer) |
| Run progress | Full-page `/runs/:runId`; poll ~2s while `running` |
| Credentials | `credentialsEnv` key → env name pairs only |
| Delete | Soft-disable via existing `DELETE /jobs/:id`; disabled jobs stay listed with badge |
| Schedule display | Humanize cron for table; forms edit cron string only |
| Run trigger | `POST /jobs/:jobId/run` → 202 + `runId`; scrape continues in background |
| Run id ownership | `runJob` remains owner of `createRun`/`finishRun`; runner returns `runId` after create, before browser work finishes |
| Concurrent runs | One `running` run per job; else 409 |
| UI kit | Cleanplate + SCSS modules; kebab-case filenames |

## Architecture

```text
Browser (Vite SPA)                         Worker host
┌─────────────────────────────┐            ┌──────────────────────────────┐
│ AppShell: Jobs|Runs|Status  │  Bearer    │ HTTP API (embedded)          │
│ react-router                │ ─────────► │ jobs CRUD + runs GET         │
│ apiFetch + session token    │            │ POST /jobs/:id/run           │
└─────────────────────────────┘            │   → onRunJob(jobId)          │
                                           │   → runJob (createRun early) │
                                           │ Mongo store + Playwright     │
                                           └──────────────────────────────┘
```

## Routes (web)

| Path | Purpose |
| --- | --- |
| `/` | Redirect to `/jobs` |
| `/jobs` | Jobs table + actions |
| `/jobs/new` | Create job form |
| `/jobs/:jobId` | Edit job form |
| `/runs` | Runs history table + filters |
| `/runs/:runId` | Run detail + polling |
| `/status` | Existing API status probes |

## API

### Existing (unchanged behavior)

- `GET /jobs`, `GET /jobs/:id`, `POST /jobs`, `PATCH /jobs/:id`, `DELETE /jobs/:id` (soft-disable)
- `GET /runs?jobId=&limit=`, `GET /runs/:id`
- Bearer auth; CORS allowlist as today

### New: `POST /jobs/:jobId/run`

**Auth:** Bearer required.

**Routing:** Match `POST /jobs/:jobId/run` **before** generic `GET|PATCH|DELETE /jobs/:id` handlers so `run` is never treated as a job id.

**Flow:**

1. If `onRunJob` not configured → **503** `{ error: 'Runner unavailable' }`
2. Load job; missing → **404**
3. Job `enabled === false` → **409** `{ error: 'Job disabled' }`
4. If store already has a run for this job with `status: 'running'` → **409** `{ error: 'Job already running' }` (implement via `listRuns({ jobId, limit })` and check for any `running`, or a dedicated store helper if added later)
5. Call `onRunJob(jobId)` which:
   - Starts `runJob` (or thin wrapper)
   - Resolves with `runId` as soon as `createRun` completes
   - Continues Playwright work without blocking further HTTP handling
6. Respond **202** `{ id: runId }` (run document id)

**`startServer` input:** add optional `onRunJob?: (jobId: string) => Promise<string>` (returns run id after create).

**Worker daemon:** pass `onRunJob` that loads config from store, invokes `runJobs`/`runJob` with store deps, and surfaces the created run id (small core refactor so `runJob` can report id immediately after `createRun`, e.g. `onRunCreated` callback or split start helper).

## UI details

### Shell

- Cleanplate `AppShell` + `Header` with menu items Jobs, Runs, Status
- TokenGate remains available (override token); protected pages require a resolved token

### Jobs table (`/jobs`)

Columns: ID, Provider, Enabled (`Badge`), Schedule (humanized), Notify title, Actions.

Actions per row:

- **Run now** — disabled in the UI when the job is disabled; concurrent-run conflicts are enforced by the API (409 → Alert). On success navigate to `/runs/:runId`
- **Edit** — navigate to `/jobs/:jobId`
- **Disable** / **Enable** — Disable uses `ConfirmDialog` then `DELETE`; Enable uses `PATCH` `{ enabled: true }`

Schedule humanize (client helper):

- `null` / empty → “Manual only”
- Common patterns (e.g. `0 9 * * *` → “Every day at 9:00 AM”); fallback: show raw cron if unrecognized

### Job form (`/jobs/new`, `/jobs/:jobId`)

Fields:

- `id` — required on create; read-only on edit
- `provider` — select `tnpdcl` \| `dummy` (known built-ins)
- `enabled` — toggle
- `schedule` — raw cron string; empty means `null` (manual)
- `notify.title` — required
- `credentialsEnv` — dynamic key/value rows (credential field name → env var name)

Submit: `POST /jobs` or `PATCH /jobs/:id`; success → `/jobs`.

### Runs table (`/runs`)

Filters: job id, status (`running` \| `success` \| `failed`).

Columns: Run id, Job, Provider, Status badge, Started, Duration.

Row click → `/runs/:runId`. Use API `jobId` + `limit`; client-side status filter and Table pagination as needed.

### Run detail (`/runs/:runId`)

Show: run id, status badge, job + provider, started/duration, bill summary (success), error code/message (failed), flags (`recoveryAttempted`, `recoverySucceeded`, `overlayActivated`, `screenshotPath`).

While `status === 'running'`, poll `GET /runs/:id` about every 2 seconds; stop on terminal status or unmount.

Links: back to `/runs`, open job `/jobs/:jobId`.

### Status (`/status`)

Move existing `StatusPage` here; behavior unchanged.

## Error handling

| Case | UI / API |
| --- | --- |
| Missing/invalid token | TokenGate + auth Alert; no protected fetches |
| Network / CORS | Alert via existing `ApiClientError` |
| Form validation | Inline field errors |
| Run now 409 / 404 / 503 | Alert on Jobs; stay on page |
| Run not found | Empty/error state on detail + link to `/runs` |
| Background failure | Detail shows `failed` after poll |

## Testing

| Area | Coverage |
| --- | --- |
| API | `POST /jobs/:id/run` — 202, 404, 409 disabled, 409 concurrent, 503 without runner (mock `onRunJob`) |
| Web | Schedule humanize helper; Run now navigates to detail; detail stops polling on terminal status; router renders hubs |
| Existing | Auth, CORS, api-client tests remain |

No live Playwright E2E against real TNPDCL in CI for this slice.

## Package / file layout (indicative)

```text
apps/web/src/
  app.tsx                         # Router + AppShell
  pages/
    jobs-page.tsx
    job-form-page.tsx
    runs-page.tsx
    run-detail-page.tsx
    status-page.tsx               # moved/adapted
  components/
    token-gate.tsx
    jobs-table.tsx
    runs-table.tsx
    credentials-env-editor.tsx
  lib/
    api-client.ts
    auth-token.ts
    jobs-api.ts
    runs-api.ts
    cron-humanize.ts
apps/api/src/
  routes.ts                       # + POST /jobs/:id/run
  server.ts                       # + onRunJob
packages/core/src/
  job-runner.ts                   # early runId reporting for trigger
apps/worker/src/
  cli.ts                          # wire onRunJob in daemon
```

Filenames: kebab-case per workspace rules.

## Success criteria

- Operator can create/edit/enable/disable jobs and see humanized schedules in the table
- Run now returns quickly, opens run detail, and detail updates to success/failed without refresh
- `/runs` lists history with filters; URLs are shareable
- Disabled jobs remain visible; Run now blocked for disabled / already-running jobs
- `npm run test` covers new API and critical web behaviors
