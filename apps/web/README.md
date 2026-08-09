# @billing-agent/web

React (Vite) UI for the billing-agent HTTP API. Uses Cleanplate + SCSS modules.

## App hubs and routes

The app is organized into hubs under a router shell:

- `/jobs` - list jobs, run now, edit, soft-disable/enable
- `/jobs/new` - create job
- `/jobs/:jobId` - edit job
- `/runs` - list/filter runs
- `/runs/:runId` - run detail with polling while status is `running`
- `/status` - API health/auth probes
- `/settings` - API token session override (TokenGate)

Notes:

- Schedules are shown in humanized form in tables, but edited as raw cron in forms.
- Empty schedule means manual-only (`null` in API payloads).
- Job disable is soft-disable only (`DELETE /jobs/:id` sets `enabled: false`).
- Credentials are env **names** only (`credentialsEnv`), never secret values.
- `Run` calls `POST /jobs/:id/run` and navigates to the created run detail.
- The run trigger requires the worker daemon API (`billing-agent daemon`) with `onRunJob` wiring.

## Local development

1. Run the worker daemon (API on `HTTP_PORT`, default `8080`) with CORS:

```bash
# in repo root .env
CORS_ORIGINS=http://localhost:5173
```

2. Configure the web app:

```bash
cp apps/web/.env.example apps/web/.env
# set VITE_API_BASE_URL=http://127.0.0.1:8080
# optional: VITE_API_TOKEN=<same as API_TOKEN>
```

3. Start Vite:

```bash
npm run dev:web
```

Open the printed local URL. Without `VITE_API_TOKEN`, open **Settings** and use the token form (session override).

## Vercel

Create a Vercel project linked to this repo:

- Root Directory: `apps/web`
- Config file: `vercel.json` (install from monorepo root with `--ignore-scripts`, build `dist`, SPA rewrite)
- Env: `VITE_API_BASE_URL` (required), `VITE_API_TOKEN` (optional)
- On the API host, set `CORS_ORIGINS` to include the Vercel production origin (and preview origins if needed), e.g. `https://your-app.vercel.app`

## Scripts

- `npm run dev` - Vite dev server
- `npm run build` - production bundle
- `npm test` - Vitest
