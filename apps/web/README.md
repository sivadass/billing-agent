# @billing-agent/web

React (Vite) UI for the billing-agent HTTP API. Uses Cleanplate + SCSS modules.

## App hubs and routes

The app is organized into hubs under a router shell:

- `/login` - public email/password login (JWT stored in `sessionStorage`)
- `/jobs` - list jobs, run now, edit, soft-disable/enable
- `/jobs/new` - create job
- `/jobs/:jobId` - edit job
- `/runs` - list/filter runs
- `/runs/:runId` - run detail with polling while status is `running`
- `/status` - API health/auth probes

Notes:

- All hubs except `/login` require a JWT (protected layout + Log out in the header).
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
JWT_SECRET=replace-with-strong-random-secret
```

2. Configure the web app:

```bash
cp apps/web/.env.example apps/web/.env
# set VITE_API_BASE_URL=http://127.0.0.1:8080
```

Provision a user in Mongo (see root `README.md`: `hash-password` + Atlas insert), then sign in at `/login`.

3. Start Vite:

```bash
npm run dev:web
```

Open the printed local URL. Unauthenticated visits to hubs redirect to `/login`.

## Vercel

Create a Vercel project linked to this repo:

- Root Directory: `apps/web`
- Config file: `vercel.json` (install from monorepo root with `--ignore-scripts`, build `dist`, SPA rewrite)
- Env: `VITE_API_BASE_URL` (required)
- On the API host, set `CORS_ORIGINS` to include the Vercel production origin (and preview origins if needed), e.g. `https://your-app.vercel.app`

## Scripts

- `npm run dev` - Vite dev server
- `npm run build` - production bundle
- `npm test` - Vitest
