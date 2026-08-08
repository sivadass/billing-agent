# Local Testing and Sign-off Guide

Use this guide to validate the full feature set on your machine before sign-off.

## 1) Confirm you are on the expected branch

```bash
git branch --show-current
git pull origin feat/billing-manager
```

Expected branch: `feat/billing-manager`.

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
- `API_TOKEN` (any strong random string for local testing)
- `HTTP_PORT` (default `8080`)
- `NTFY_TOPIC` (or a dummy/private topic)
- `MISTRAL_API_KEY` (required for TNPDCL + recovery path)
- `TNPDCL_USERNAME`, `TNPDCL_PASSWORD` (only if you want TNPDCL live testing)

## 5) Seed jobs and settings into MongoDB

```bash
npm run dev -w @billing-agent/worker -- seed-jobs --from jobs.example.json
```

## 6) Run automated verification

```bash
npm test
npm run build
```

Expected: both commands pass.

## 7) Start daemon (scheduler + embedded API)

```bash
npm run start
```

Keep this terminal running.

## 8) Validate API quickly with curl

In another terminal:

```bash
export API_TOKEN="your-local-api-token"
export BASE_URL="http://localhost:8080"
```

Health (no auth):

```bash
curl "$BASE_URL/health"
```

Jobs (with bearer):

```bash
curl -H "Authorization: Bearer $API_TOKEN" "$BASE_URL/jobs"
```

Create a test job:

```bash
curl -X POST "$BASE_URL/jobs" \
  -H "Authorization: Bearer $API_TOKEN" \
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
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

Soft-delete it:

```bash
curl -X DELETE "$BASE_URL/jobs/smoke-test-local" \
  -H "Authorization: Bearer $API_TOKEN"
```

## 9) Validate with Postman collection

Import:

- `postman/billing-agent-api.postman-collection.json`

Set collection variables:

- `baseUrl` = `http://localhost:8080`
- `apiToken` = your local `API_TOKEN`
- `jobId` = existing job id (for example `smoke-test`)
- `runId` = value from `List Runs`

Run requests in this order:

1. `Health`
2. `List Jobs`
3. `Create Job`
4. `Patch Job`
5. `Soft Delete Job`
6. `List Runs`
7. `Get Run By Id`

## 10) Validate one CLI run + run history

Run one job:

```bash
npm run dev -w @billing-agent/worker -- run --job smoke-test
```

Then confirm run history is persisted:

```bash
curl -H "Authorization: Bearer $API_TOKEN" "$BASE_URL/runs?jobId=smoke-test&limit=5"
```

## 11) Optional: recovery/overlay learning checks

If you want to specifically validate recovery behavior:

- Use a scenario that triggers a recoverable error (`LoginError`, `ScrapeError`, or `TimeoutError`).
- Confirm only one recovery attempt happens per run.
- Confirm a successful recovery writes/updates overlay data in MongoDB.
- Confirm activation occurs only after `successCount >= 3`.

## 12) Sign-off checklist

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] daemon starts with API and scheduler
- [ ] `/health` works without auth
- [ ] all `/jobs` CRUD routes work with bearer token
- [ ] `/runs` and `/runs/:id` return persisted run data
- [ ] Postman collection imports and runs successfully
- [ ] no secrets were committed (`.env`, real credentials, local-only files)

If all boxes are checked, this branch is ready for your sign-off.
