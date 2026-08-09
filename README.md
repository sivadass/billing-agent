# billing-agent

Billing automation with a recovery-only learning path:

- deterministic Playwright adapters on the happy path (cheap),
- one-shot Mistral overlay recovery + one retry on recoverable failures,
- MongoDB as runtime source of truth (users/jobs/settings/overlays/runs),
- JWT-protected HTTP API embedded in the worker daemon; jobs and runs are scoped per user.

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
| `JWT_SECRET` | Signs/verifies login JWTs; required for all API routes except `/health` and `/auth/login` (required for daemon) |
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

Seed job entries have an empty `userId` until assigned to a real user (see [User accounts](#user-accounts-mongodb-atlas) below).

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

   This looks up the user by email (failing if the user doesn't exist), sets `userId` on every job and run currently missing one, and prints the counts updated.

4. Log in from the web app (or `POST /auth/login`) with the email/password to get a Bearer JWT.

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
- `POST /auth/login` (no auth) — body `{ email, password }`
- `GET /runs`
- `GET /runs/:id`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs`
- `POST /jobs/:id/run` (manual trigger, returns `202 { id }`)
- `PATCH /jobs/:id`
- `DELETE /jobs/:id` (soft-disable via `enabled: false`)

`/jobs` and `/runs` routes are scoped to the authenticated user; accessing another user's job/run returns `404`.

Log in to get a JWT, then use it as a Bearer token:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-plaintext-password"}' | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/jobs
```

Create a job:

```bash
curl -X POST http://localhost:8080/jobs \
  -H "Authorization: Bearer $TOKEN" \
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
- `apiToken` (JWT returned by `POST /auth/login`)
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
- Set runtime env vars: `MONGODB_URI`, `JWT_SECRET`, `HTTP_PORT`, `CORS_ORIGINS`, `NTFY_TOPIC`, `MISTRAL_API_KEY`, provider credentials.
- Expose `HTTP_PORT`.
- Health check: `GET /health`.
- Recommended memory: at least 1 GB (Chromium spikes).

Optional post-deploy seed:

```bash
node apps/worker/dist/cli.js seed-jobs --from jobs.coolify.json
node apps/worker/dist/cli.js migrate-job-owners --email you@example.com
```

## Web UI (`apps/web`)

Vite + React + Cleanplate SPA hosted on Vercel. Talks to the worker API via `VITE_API_BASE_URL` with a Bearer JWT from `/login` (stored in `sessionStorage`). Protected hubs:

- `/login` (public)
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
