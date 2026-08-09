# @billing-agent/web

React (Vite) UI for the billing-agent HTTP API. Uses Cleanplate + SCSS modules.

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

Open the printed local URL. Without `VITE_API_TOKEN`, use the TokenGate form (session override).

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
