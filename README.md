# billing-agent

Billing automation with a recovery-only learning path:

- deterministic Playwright adapters on the happy path (cheap),
- one-shot Mistral overlay recovery + one retry on recoverable failures,
- MongoDB as runtime source of truth (jobs/settings/overlays/runs),
- token-protected HTTP API embedded in the worker daemon.

## Workspace layout

```text
apps/
  api/       # @billing-agent/api (HTTP server)
  web/       # @billing-agent/web (Vite + React API shell)
  worker/    # @billing-agent/worker (CLI + scheduler daemon)
packages/
  core/      # @billing-agent/core (adapters, config, runner, recovery, store)
```

## Requirements

- Node.js 20+
- npm
- MongoDB (Atlas or self-hosted)

## Environment

Copy and edit:

```bash
cp .env.example .env
```

Key runtime variables:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Mongo connection string (required) |
| `API_TOKEN` | Bearer token for all API routes except `/health` (required for daemon) |
| `HTTP_PORT` | API listen port (default `8080`) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call API (optional) |
| `NTFY_TOPIC` | ntfy topic (secret) |
| `MISTRAL_API_KEY` | Mistral API key (used for captcha + recovery) |
| `TNPDCL_USERNAME` | TNPDCL login |
| `TNPDCL_PASSWORD` | TNPDCL login |

## Install

```bash
npm install
```

`postinstall` downloads Chromium via Playwright.

## Seed jobs/settings into Mongo

Runtime config is loaded from MongoDB, not `jobs.json`. Seed once (and repeat whenever you intentionally replace seeded config):

```bash
npm run dev -w @billing-agent/worker -- seed-jobs --from jobs.example.json
```

## Commands

```bash
# Build all workspaces
npm run build

# Run one job
npm run dev -w @billing-agent/worker -- run --job smoke-test

# Run all enabled jobs once
npm run dev -w @billing-agent/worker -- run --all

# Long-running daemon: scheduler + embedded HTTP API
npm run start
```

Exit codes: `0` success, `1` one or more jobs failed, `2` config/usage errors.

## HTTP API

Base URL: `http://localhost:${HTTP_PORT:-8080}`

- `GET /health` (no auth)
- `GET /runs`
- `GET /runs/:id`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs`
- `POST /jobs/:id/run` (manual trigger, returns `202 { id }`)
- `PATCH /jobs/:id`
- `DELETE /jobs/:id` (soft-disable via `enabled: false`)

Auth on all non-health routes:

```bash
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:8080/jobs
```

Create a job:

```bash
curl -X POST http://localhost:8080/jobs \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "smoke-test",
    "provider": "dummy",
    "enabled": true,
    "schedule": null,
    "credentialsEnv": {},
    "notify": { "title": "Dummy Bill" }
  }'
```

## Postman collection

Import:

- `postman/billing-agent-api.postman-collection.json`

Collection variables:

- `baseUrl` (default `http://localhost:8080`)
- `apiToken` (`API_TOKEN` value from your `.env`)
- `jobId` (default `smoke-test`)
- `runId` (set after listing runs)

The collection includes all current API endpoints (`/health`, `/runs`, `/jobs` CRUD, `/jobs/:id/run`). `Health` is no-auth; all other requests use bearer auth via `{{apiToken}}`.

## Overlay learning behavior

- Only recoverable errors are eligible: `LoginError`, `ScrapeError`, `TimeoutError`.
- Recovery performs at most one model call and one retry per run.
- Overlay patches are schema-validated (selector/pattern keys only).
- Successful recoveries increment overlay success count.
- Overlay auto-activates at `successCount >= 3`.

## Tests and build

```bash
npm test
npm run build
```

CI/test expectations: mocks only; no live Atlas and no live TNPDCL logins.

## Coolify deployment (single container)

- Build with `Dockerfile` (`npm run build:server` — core/api/worker only; web SPA is not included).
- Runtime command is already `worker daemon` (scheduler + embedded API in one process).
- Set runtime env vars: `MONGODB_URI`, `API_TOKEN`, `HTTP_PORT`, `CORS_ORIGINS`, `NTFY_TOPIC`, `MISTRAL_API_KEY`, provider credentials.
- Expose `HTTP_PORT`.
- Health check: `GET /health`.
- Recommended memory: at least 1 GB (Chromium spikes).

Optional post-deploy seed:

```bash
node apps/worker/dist/cli.js seed-jobs --from jobs.coolify.json
```

## Web UI (`apps/web`)

Vite + React + Cleanplate SPA hosted on Vercel. Talks to the worker API via `VITE_API_BASE_URL` and Bearer token (`VITE_API_TOKEN` or session override). The web shell provides Jobs, Runs, and Status hubs with router URLs:

- `/jobs`, `/jobs/new`, `/jobs/:jobId`
- `/runs`, `/runs/:runId` (polls run detail while running)
- `/status`

```bash
npm run dev:web
```

On the API host, allow browser origins:

```bash
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

See `apps/web/README.md` for Vercel settings.
