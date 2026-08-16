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
| `JWT_SECRET` | Signs/verifies login JWTs; required for all API routes except `/health` and `/auth/login` (required for daemon) |
| `HTTP_PORT` | API listen port (default `8080`) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call API (optional) |
| `NTFY_TOPIC` | ntfy topic (secret) |
| `MISTRAL_API_KEY` | Mistral API key (used for captcha + recovery) |
| `TNPDCL_USERNAME` | TNPDCL login |
| `TNPDCL_PASSWORD` | TNPDCL login |
| `SECRETS_MASTER_KEY` | AES-256-GCM key wrapping per-job secrets (`secrets` collection); required before running/migrating any job with credentials |

### Generating `SECRETS_MASTER_KEY`

A 32-byte key, hex (64 chars) or base64 (44 chars):

```bash
# hex
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# or base64
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store the result in `.env` / the host's secret manager. Losing or rotating this key makes every existing `secrets` row undecryptable — back it up like a password. Missing or malformed values raise `ConfigError` the moment a job actually needs to encrypt/decrypt a secret (not at process boot).

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

## Migrating legacy jobs/watches to the generic job model

`migrate-generic-jobs` is a one-time, idempotent migration from the old `provider` / `credentialsEnv` billing jobs and the separate `watches` / `price_checks` pipeline onto the unified `JobDocument` / `RunDocument` model (`engine: 'adapter' | 'workflow'`). Requires `SECRETS_MASTER_KEY` (see above) whenever a legacy job actually has `credentialsEnv` values to encrypt.

```bash
npm run dev -w @billing-agent/worker -- migrate-generic-jobs
```

- Legacy billing jobs (`provider` + `credentialsEnv`): each `credentialsEnv` entry is resolved from `process.env` and encrypted into a `secrets` row (never written to the job document); the job gets `engine: 'adapter'`, `adapterId: provider`, and the adapter's default `startUrl`.
- Watches become `engine: 'workflow'` jobs with a deterministic `goto` + `extract` workflow (not runnable until the workflow interpreter ships); `price_checks` rows are copied into `runs`.
- Settings keep `ntfy.baseUrl` / `priority` / `jobsGeneration`; the resolved ntfy topic becomes `ntfy.defaultTopic` and `topicEnv` / `watchesGeneration` are dropped.
- Safe to re-run: jobs that already have `engine` set, watches with an existing workflow job, and price checks with an existing run are all skipped. `watches` and `price_checks` are never deleted in this slice.

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
- `GET /watches`
- `POST /watches`
- `GET /watches/:id`
- `PATCH /watches/:id`
- `DELETE /watches/:id` (hard delete + cascades `price_checks`)
- `POST /watches/:id/check` (manual trigger, returns `202 { id }`, `409` if running)
- `GET /watches/:id/checks`

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
    "name": "Dummy Bill",
    "engine": "adapter",
    "adapterId": "dummy",
    "enabled": true,
    "schedule": null,
    "notify": {
      "title": "Dummy Bill",
      "on": "always",
      "channel": { "type": "ntfy", "topic": "bills" }
    }
  }'
```

A `workflow` job replaces `adapterId` with a `startUrl` plus `schema` /
`workflow` steps:

```bash
curl -X POST http://localhost:8080/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "shoe-price",
    "name": "Shoe price",
    "engine": "workflow",
    "startUrl": "https://sivadass.in/",
    "goal": "Read the listed price",
    "schema": [{ "key": "price", "label": "Price", "type": "price" }],
    "workflow": [
      { "id": "open", "type": "goto", "url": "https://sivadass.in/" },
      {
        "id": "read-price",
        "type": "extract",
        "fields": [
          { "key": "price", "selector": ".product-price", "strategy": "price" }
        ]
      }
    ],
    "notify": { "title": "Shoe price" }
  }'
```

Shapes used above:

- `schema` entries are `{ key, label, type }`, where `type` is one of `string`,
  `number`, `price`, `date`. They describe the `result` a run produces.
- `workflow` steps are `{ id, type, ... }`: `goto` takes `url`, `fill` takes
  `selector` plus `source` (`secret` with a `secretKey`, or `literal` with a
  `value`), `click` and `assert` take `selector`, `wait` takes an optional
  `selector` / `timeoutMs`, `solve_captcha` takes `imageSelector` /
  `inputSelector`, and `extract` takes `fields` of
  `{ key, selector?, strategy? }` with `strategy` one of `text`, `price`,
  `json_ld`, `shopify_json`.

Notes on the payload:

- The old `provider` spelling is still accepted as an alias for `adapterId` so
  existing clients keep working, but it is never stored or returned — responses
  are canonical (`engine`, `adapterId`, `startUrl`, `result`).
- Omitted fields fall back to defaults (`notify.on` to `always`, `notify.channel`
  to ntfy). A field that *is* supplied must be valid: a bad `enabled`,
  `notify.on`, or channel is a `400` rather than a silent default.
- `startUrl`, a `webhook` channel `url`, and an ntfy `baseUrl` must be public
  http(s) URLs; localhost, private and link-local ranges, the cloud metadata
  address, and `.local` / `.internal` hosts are rejected. A `workflow` job must
  supply a `startUrl`.
- `secretIds`, `lastResult`, `userId`, and the timestamps are server-owned and
  ignored if sent.

Secrets are write-only. `GET /jobs/:id/secrets` lists key names only, and
`PUT /jobs/:id/secrets` stores new values encrypted with `SECRETS_MASTER_KEY`
(omitted keys keep their current value; a re-sent key is re-encrypted in place):

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/jobs/smoke-test/secrets
# {"keys":[{"key":"TNPDCL_PASSWORD","set":true}]}

curl -X PUT http://localhost:8080/jobs/smoke-test/secrets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "values": { "TNPDCL_PASSWORD": "new-password" } }'
```

Stored values are never returned by any endpoint, and the write is rejected with
`409` while that job has a run in flight.

## Postman collection

Import:

- `postman/billing-agent-api.postman-collection.json`

Collection variables:

- `baseUrl` (default `http://localhost:8080`)
- `apiToken` (JWT returned by `POST /auth/login`)
- `jobId` (default `smoke-test`)
- `runId` (set after listing runs)

The collection includes all current API endpoints (`/health`, `/runs`, `/jobs` CRUD, `/jobs/:id/run`, `/jobs/:id/secrets`). `Health` is no-auth; all other requests use bearer auth via `{{apiToken}}`.

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
- `/watches`, `/watches/new`, `/watches/:watchId/edit`, `/watches/:watchId`
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
