# Local Testing and Sign-off Guide

Use this guide to validate the full feature set on your machine before sign-off.

## 1) Confirm you are on the expected branch

```bash
git branch --show-current
```

Expected branch for this work: `feat/jwt-auth` (or your current feature branch).

## 2) Prerequisites

- Node.js `20+`
- npm
- A reachable MongoDB instance (local or Atlas)

If you want a quick local MongoDB:

```bash
docker run --name billing-agent-mongo -p 27017:27017 -d mongo:7
```

## 3) Install dependencies

```bash
npm install
```

## 4) Configure environment

```bash
cp .env.example .env
```

Set at least these values in `.env`:

- `MONGODB_URI` (for example `mongodb://127.0.0.1:27017/billing_agent`)
- `JWT_SECRET` (strong random secret used to sign/verify login JWTs)
- `HTTP_PORT` (default `8080`)
- `CORS_ORIGINS` (include `http://localhost:5173` when using the web UI)
- `NTFY_TOPIC` (or a dummy/private topic)
- `MISTRAL_API_KEY` (required for TNPDCL + recovery path)
- `TNPDCL_USERNAME`, `TNPDCL_PASSWORD` (only if you want TNPDCL live testing)

## 5) Provision a user + seed jobs

```bash
npm run dev -w @billing-agent/worker -- hash-password 'your-plaintext-password'
```

Insert a `users` document in Mongo (lowercase `email`, bcrypt `passwordHash`, UUID `id`, ISO `createdAt`) — see root `README.md`.

```bash
npm run dev -w @billing-agent/worker -- seed-jobs --from jobs.example.json
npm run dev -w @billing-agent/worker -- migrate-job-owners --email you@example.com
```

## 6) Run automated verification

```bash
npm test -w @billing-agent/core
npm test -w @billing-agent/api
npm test -w @billing-agent/web
npm run build
```

Expected: tests and builds pass.

## 7) Start daemon (scheduler + embedded API)

```bash
npm run start
```

Keep this terminal running.

## 8) Validate API quickly with curl

In another terminal:

```bash
export BASE_URL="http://localhost:8080"
export TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-plaintext-password"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
```

Health (no auth):

```bash
curl "$BASE_URL/health"
```

Jobs (with JWT):

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE_URL/jobs"
```

Create a test job:

```bash
curl -X POST "$BASE_URL/jobs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "smoke-test-local",
    "provider": "dummy",
    "enabled": true,
    "schedule": null,
    "credentialsEnv": {},
    "notify": { "title": "Dummy Bill Local" }
  }'
```

Patch it:

```bash
curl -X PATCH "$BASE_URL/jobs/smoke-test-local" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

Soft-delete it:

```bash
curl -X DELETE "$BASE_URL/jobs/smoke-test-local" \
  -H "Authorization: Bearer $TOKEN"
```

## 9) Validate with Postman collection

Import:

- `postman/billing-agent-api.postman-collection.json`

Set collection variables:

- `baseUrl` = `http://localhost:8080`
- `apiToken` = JWT from `POST /auth/login`
- `jobId` = existing job id (for example `smoke-test`)
- `runId` = value from `List Runs`

Run requests in this order:

1. `Health`
2. Login (or paste JWT into `apiToken`)
3. `List Jobs`
4. `Create Job`
5. `Patch Job`
6. `Soft Delete Job`
7. `List Runs`
8. `Get Run By Id`

## 10) Validate web login

```bash
npm run dev:web
```

Open the printed URL:

1. Visiting `/jobs` while logged out redirects to `/login`
2. Sign in with the provisioned email/password
3. Create a job and confirm its Mongo document has your `userId`
4. Log out and confirm hubs are inaccessible

## 11) Validate one CLI run + run history

Run one job:

```bash
npm run dev -w @billing-agent/worker -- run --job smoke-test
```

Then confirm run history is persisted:

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE_URL/runs?jobId=smoke-test&limit=5"
```

## 12) Optional: recovery/overlay learning checks

If you want to specifically validate recovery behavior:

- Use a scenario that triggers a recoverable error (`LoginError`, `ScrapeError`, or `TimeoutError`).
- Confirm only one recovery attempt happens per run.
- Confirm a successful recovery writes/updates overlay data in MongoDB.
- Confirm activation occurs only after `successCount >= 3`.

## 13) Sign-off checklist

- [ ] package tests pass (`core`, `api`, `web`)
- [ ] `npm run build` passes
- [ ] daemon starts with API and scheduler (`JWT_SECRET` set)
- [ ] `/health` works without auth; `/auth/login` issues a JWT
- [ ] all `/jobs` CRUD routes work with Bearer JWT and are scoped to the user
- [ ] `/runs` and `/runs/:id` return persisted run data for that user only
- [ ] web `/login` + protected hubs + logout work
- [ ] no secrets were committed (`.env`, real credentials, local-only files)

If all boxes are checked, this branch is ready for your sign-off.
