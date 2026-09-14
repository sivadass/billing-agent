# billing-agent

Billing automation with a recovery-only learning path:

- deterministic Playwright adapters on the happy path (cheap),
- one-shot Mistral overlay recovery + one retry on recoverable failures,
- MongoDB as runtime source of truth (users, jobs, secrets, settings, overlays, runs, watches, price checks),
- JWT-protected HTTP API embedded in the worker daemon; jobs, runs, and watches are scoped per user.

Built-in job providers: `dummy` (no credentials) and `tnpdcl` (`username` + `password`).

## Workspace layout

```text
apps/
  api/       # @billing-agent/api (HTTP route library; served by the worker daemon)
  web/       # @billing-agent/web (Vite + React API shell)
  worker/    # @billing-agent/worker (CLI + scheduler daemon)
packages/
  core/      # @billing-agent/core (adapters, config, runner, recovery, store)
  price-monitor/ # @billing-agent/price-monitor (price extraction, compare, watch runner)
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
| `JWT_SECRET` | Signs/verifies login JWTs; required for all API routes except `/health` and `/auth/login` (required for daemon). Tokens expire after 7 days. |
| `HTTP_PORT` | API listen port (default `8080`) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call API (optional) |
| `NTFY_TOPIC` | ntfy topic (secret) |
| `MISTRAL_API_KEY` | Mistral API key (used for captcha + recovery + LLM price extraction) |
| `SECRETS_MASTER_KEY` | 32-byte AES-256-GCM key for per-job secrets (hex or base64). Generate with `openssl rand -hex 32`. Required to create, update, migrate, or run jobs that have secrets. |
| `TNPDCL_USERNAME` | Legacy TNPDCL login env var; copied into encrypted job secrets on first boot migrate from seed JSON, then unset on the job |
| `TNPDCL_PASSWORD` | Legacy TNPDCL login env var; same one-time migrate behavior as `TNPDCL_USERNAME` |

The web app uses `VITE_API_BASE_URL` in `apps/web/.env` (see [Web UI](#web-ui-appsweb)).

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

Seed job entries have an empty `userId` until assigned to a real user (see [User accounts](#user-accounts-mongodb-atlas) below). TNPDCL seed jobs still reference `TNPDCL_USERNAME` / `TNPDCL_PASSWORD`; `seed-jobs` and `daemon` copy those into encrypted `secrets` and then drop `credentialsEnv` from the job.

There is no `seed-watches` command. Create watches from the web UI or `POST /watches`. `watches.example.json` is a sample document shape for `run-watch`.

## User accounts (MongoDB Atlas)

There are no register / forgot-password APIs. Users are provisioned by inserting a document directly into the `users` collection (Atlas UI or `mongosh`):

1. Generate a bcrypt password hash:

   ```bash
   npm run dev -w @billing-agent/worker -- hash-password 'your-plaintext-password'
   ```

2. Insert the user document (`email` must be lowercase; `id` is any UUID you generate):

   ```json
   {
     "id": "<uuid>",
     "email": "you@example.com",
     "passwordHash": "<hash printed above>",
     "createdAt": "2026-08-09T00:00:00.000Z"
   }
   ```

   Never paste the plaintext password into Atlas — only the bcrypt hash.

3. If you have existing jobs/runs with no owner (e.g. from `seed-jobs`, or from before this feature), assign them to a user:

   ```bash
   npm run dev -w @billing-agent/worker -- migrate-job-owners --email you@example.com
   ```

   This looks up the user by email (failing if the user doesn't exist), sets `userId` on every job and run currently missing one, and prints the counts updated. Watches created through the API/UI are already owned by the authenticated user.

4. Log in from the web app (or `POST /auth/login`) with the email/password to get a Bearer JWT.

## Commands

```bash
# Build all workspaces
npm run build

# Run one job
npm run dev -w @billing-agent/worker -- run --job smoke-test

# Run all enabled jobs once
npm run dev -w @billing-agent/worker -- run --all

# Run one watch immediately
npm run dev -w @billing-agent/worker -- run-watch --id craft-glory-old-skool-vb

# Run all enabled watches once
npm run dev -w @billing-agent/worker -- run-watches

# Long-running daemon: scheduler + embedded HTTP API
npm run dev -w @billing-agent/worker -- daemon

# Same, from compiled output (after npm run build)
npm run start -w @billing-agent/worker -- daemon
```

Exit codes: `0` success, `1` one or more jobs/watches failed, `2` config/usage errors.

## HTTP API

Base URL: `http://localhost:${HTTP_PORT:-8080}`

All routes except `/health` and `/auth/login` require `Authorization: Bearer <jwt>`. Jobs, runs, and watches are scoped to the authenticated user; accessing another user's resource returns `404`.

Auth and health:

- `GET /health` (no auth)
- `POST /auth/login` (no auth) — body `{ email, password }` → `{ token, user }`. JWT expires in 7 days.

Providers:

- `GET /providers` — `{ providers: [{ id, credentialKeys }] }`

Runs:

- `GET /runs` — query `jobId`, `status` (`running` \| `success` \| `failed`), `limit` (default `10`), `offset` (default `0`); response `{ runs, total }`
- `GET /runs/:id`
- `DELETE /runs/:id` (hard delete; `409` if still running)

Jobs:

- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs` — create; write-only `secrets` object. `tnpdcl` requires `username` and `password`; `dummy` requires none. `201`
- `PATCH /jobs/:id` — cannot change `provider`; do not send `secrets` (use the secrets route)
- `DELETE /jobs/:id` — hard delete; cascades runs, secrets, and overlays. `409` if a run is in progress. Disable without deleting via `PATCH` `{ "enabled": false }`
- `POST /jobs/:id/run` — manual trigger, `202 { id }`; `409` if disabled or already running; `503` if the daemon runner is unavailable
- `GET /jobs/:id/secrets` — `{ keys: [{ key, set }] }` (never returns values)
- `PUT /jobs/:id/secrets` — body `{ values }`; omit a key to leave existing ciphertext. `409` if the job is running

Watches:

- `GET /watches`
- `POST /watches` — default schedule `0 9 * * *` when omitted
- `GET /watches/:id`
- `PATCH /watches/:id`
- `DELETE /watches/:id` (hard delete + cascades `price_checks`)
- `POST /watches/:id/check` (manual trigger, `202 { id }`; `409` if running; `503` if the daemon runner is unavailable)
- `GET /watches/:id/checks`

Log in to get a JWT, then use it as a Bearer token:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-plaintext-password"}' | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/jobs
```

Create a dummy job (no secrets):

```bash
curl -X POST http://localhost:8080/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "smoke-test",
    "provider": "dummy",
    "enabled": true,
    "schedule": null,
    "notify": { "title": "Dummy Bill" }
  }'
```

Create a TNPDCL job (secrets are write-only and stored encrypted):

```bash
curl -X POST http://localhost:8080/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "home-eb",
    "provider": "tnpdcl",
    "enabled": true,
    "schedule": "0 9 * * *",
    "notify": { "title": "TNPDCL Bill" },
    "secrets": { "username": "your-login", "password": "your-password" }
  }'
```

## Postman collection

Import:

- `postman/billing-agent-api.postman-collection.json`

Collection variables:

- `baseUrl` (default `http://localhost:8080`)
- `apiToken` (JWT returned by `POST /auth/login`)
- `jobId` (default `smoke-test`)
- `runId` (set after listing runs)

The collection covers `/health`, `/providers`, `/runs` list/get, and `/jobs` CRUD including `/jobs/:id/secrets` and `/jobs/:id/run`. `Health` is no-auth; the rest use bearer auth via `{{apiToken}}`. Obtain a token with `POST /auth/login` (not in the collection) and paste it into `apiToken`. Watches and `DELETE /runs/:id` are also not in the collection; use curl or the web UI.

## Price monitor notes

- Default watch schedule: `0 9 * * *` with cron timezone `Asia/Kolkata` (IST).
- Alert rule (v1): notify only when the new price is lower than the previous successful price **and** currency/source match.
- First successful check creates the baseline and does not notify.
- Currency/source changes reset the baseline (no notify).
- Non-positive extracted prices are treated as failed checks (no baseline update, no notify).
- SSRF protection blocks obvious local/private/link-local/metadata targets before Shopify fetch and browser navigation.
- Residual risk accepted in v1: DNS rebinding after validation is not mitigated.

## Overlay learning behavior

- Only recoverable errors are eligible: `LoginError`, `ScrapeError`, `TimeoutError`.
- Recovery performs at most one model call and one retry per run.
- Overlay patches are schema-validated against the TNPDCL selector key whitelist (`username`, `password`, `captchaInput`, and the other bill-page selectors).
- Successful recoveries increment overlay success count.
- Overlay auto-activates at `successCount >= 3`.

## Tests and build

```bash
npm test
npm run build
```

CI/test expectations: mocks only; no live Atlas and no live TNPDCL logins.

## Coolify deployment (single container)

- Build with `Dockerfile` (`npm run build:server` — core/price-monitor/api/worker only; web SPA is not included).
- Runtime command is `node apps/worker/dist/cli.js daemon` (scheduler + embedded API in one process).
- Set runtime env vars: `MONGODB_URI`, `JWT_SECRET`, `HTTP_PORT`, `CORS_ORIGINS`, `NTFY_TOPIC`, `MISTRAL_API_KEY`, `SECRETS_MASTER_KEY`. Keep `TNPDCL_USERNAME` / `TNPDCL_PASSWORD` only until the first successful boot migrate from seed JSON.
- Expose `HTTP_PORT`.
- Health check: `GET /health`.
- Recommended memory: at least 1 GB (Chromium spikes).

Optional post-deploy seed:

```bash
node apps/worker/dist/cli.js seed-jobs --from jobs.coolify.json
node apps/worker/dist/cli.js migrate-job-owners --email you@example.com
```

Further TNPDCL jobs (second login, etc.) should be created in the web UI or `POST /jobs` with `secrets`, not extra host env vars.

## Web UI (`apps/web`)

Vite + React + Cleanplate SPA hosted on Vercel. Talks to the worker API via `VITE_API_BASE_URL` with a Bearer JWT from `/login` (stored in `sessionStorage`). Job credentials are write-only: the form never displays stored secret values. Disable a job with `PATCH enabled: false`; delete is a hard delete.

Protected hubs:

- `/login` (public)
- `/jobs`, `/jobs/new`, `/jobs/:jobId`
- `/watches`, `/watches/new`, `/watches/:watchId/edit`, `/watches/:watchId`
- `/runs`, `/runs/:runId` (polls run detail while running; runs can be deleted)
- `/status`

```bash
cp apps/web/.env.example apps/web/.env
# VITE_API_BASE_URL=http://127.0.0.1:8080
npm run dev:web
```

The Vite app expects the worker daemon API to already be running.

On the API host, allow browser origins:

```bash
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

See `apps/web/README.md` for Vercel settings.
