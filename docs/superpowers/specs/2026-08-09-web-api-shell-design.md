# Web API Shell Design

**Date:** 2026-08-09  
**Status:** Approved for implementation planning  
**Related:** `2026-08-08-agentic-overlay-learning-design.md`, `apps/web/README.md`, `apps/api`

## Problem

`apps/web` is a stub. Operators need a browser UI that can reach the worker’s embedded HTTP API from local Vite and from a Netlify-hosted static SPA, without building the full jobs/runs dashboard yet.

## Goals

- Scaffold `@billing-agent/web` as Vite + React 18 + TypeScript
- Use Cleanplate as the UI framework and SCSS modules for app-specific styling
- Provide an API shell: env-based config, Bearer token handling, and a thin status page
- Support Netlify static hosting talking to a separately hosted API (Coolify/VPS)
- Add allowlist CORS on `@billing-agent/api` so the browser can call the API cross-origin

## Non-goals

- Jobs CRUD UI or runs history table
- React Router multi-page app
- Netlify Functions / Edge BFF (token stays in the browser for v1)
- Vite dev proxy or Netlify `/api` rewrites
- Live Netlify ↔ API E2E in CI

## Decisions

| Topic | Decision |
| --- | --- |
| Scope | Scaffold + API shell + status page (not full dashboard) |
| Auth | `VITE_API_TOKEN` default; optional TokenGate override in `sessionStorage` |
| Connectivity | Direct `VITE_API_BASE_URL` + API CORS allowlist |
| Hosting | Netlify static SPA; API remains on worker host |
| UI kit | Cleanplate + Material Symbols; prefer component props over inline styles |
| CSS | SCSS modules; kebab-case; prefer design tokens / CSS variables |
| Routing | Single view; no router in v1 |

## Architecture

```text
Netlify (static SPA)                    Coolify / VPS
┌─────────────────────────┐             ┌──────────────────────────┐
│  @billing-agent/web     │  HTTPS +    │  worker daemon           │
│  Vite React + Cleanplate│  Bearer ──► │  + embedded HTTP API     │
│  VITE_API_BASE_URL      │             │  CORS_ORIGINS allowlist  │
└─────────────────────────┘             └──────────────────────────┘
```

Locally, the same client points `VITE_API_BASE_URL` at `http://127.0.0.1:8080` (or whatever `HTTP_PORT` is).

## Package layout

```text
apps/web/
  package.json                 # @billing-agent/web
  vite.config.ts
  tsconfig.json
  index.html                   # Material Symbols Outlined stylesheet
  netlify.toml                 # build, publish dist, SPA fallback
  .env.example                 # VITE_API_BASE_URL, VITE_API_TOKEN
  src/
    main.tsx                   # import cleanplate/dist/index.css
    app.tsx
    app.module.scss
    lib/
      api-client.ts            # fetch wrapper + Bearer header
      auth-token.ts            # sessionStorage override → VITE_API_TOKEN
    components/
      token-gate.tsx
      token-gate.module.scss
      status-page.tsx
      status-page.module.scss
```

Root workspace: add `@billing-agent/web` to root `build` and `test`; add a `dev:web` script (`npm run dev -w @billing-agent/web`). Filenames use kebab-case per workspace rules.

## Auth resolution

Priority:

1. `sessionStorage` override set via TokenGate
2. Else `import.meta.env.VITE_API_TOKEN`
3. Else show TokenGate; do not call protected endpoints until a token exists

Clearing the override restores the env token when present. Never log or render the full token value.

## Status page

Without a resolved token: render TokenGate only (no API probes).

When a token is available:

1. `GET {base}/health` (public) — connectivity / process up
2. `GET {base}/jobs` with Bearer — auth + store path smoke

Show: API base URL, health result, auth result, last-checked time, Retry. Surface TokenGate to set or clear an override at any time.

### Client error mapping

| Condition | UI |
| --- | --- |
| Network / failed fetch (incl. CORS) | Alert: cannot reach API |
| Health non-OK | Alert with status |
| Protected probe `401` / `403` | Alert: auth failed; keep TokenGate available |
| Other non-OK | Alert with status / message when present |

## API CORS

Extend `startServer` with optional `corsOrigins: string[]`.

Worker reads `CORS_ORIGINS` (comma-separated). Empty or absent → no CORS headers (current behavior preserved).

When request `Origin` is in the allowlist:

- Echo that origin in `Access-Control-Allow-Origin`
- `Access-Control-Allow-Headers: Authorization, Content-Type`
- `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`
- Short-circuit `OPTIONS` with `204` **before** Bearer auth

Document in root `.env.example`:

```bash
CORS_ORIGINS=http://localhost:5173,https://your-app.netlify.app
```

## Cleanplate conventions

- Import `cleanplate/dist/index.css` once at app root
- Prefer Cleanplate props for spacing/layout (`margin`, `padding`, `gap` suffix API — no `m-`/`p-`/`g-` prefix in prop values)
- Include Material Symbols Outlined in `index.html` for `Icon`
- Copy/adapt Cleanplate `AGENTS.md` guidance into the web app or repo docs only if useful for future agents; not required for runtime

## Netlify

Site base directory: `apps/web` (so `netlify.toml` and `dist/` resolve relative to that package).

`apps/web/netlify.toml`:

- Build command: `npm run build` (package script → `vite build`)
- Publish directory: `dist`
- SPA fallback: `/*` → `/index.html` with status `200`

If Netlify installs from the monorepo root instead, use root build `npm run build -w @billing-agent/web` and publish `apps/web/dist`; prefer the base-directory=`apps/web` setup unless the install graph requires hoisting from root.

Netlify environment variables:

- `VITE_API_BASE_URL` (required) — public API origin, no trailing slash
- `VITE_API_TOKEN` (optional) — default Bearer token for personal deploys

`VITE_API_BASE_URL` must be an absolute origin (e.g. `https://api.example.com`). The client joins paths as `{base}/health` and `{base}/jobs`.

## Testing

| Area | Coverage |
| --- | --- |
| API | CORS allow, deny, and OPTIONS preflight |
| Web | Token resolution + TokenGate; `api-client` Bearer header with mocked `fetch` |
| CI | No live Netlify or live API E2E in v1 |

Web tests: Vitest + Testing Library + jsdom.

## Success criteria

- `npm run build -w @billing-agent/web` produces a static `dist/` suitable for Netlify
- Locally, with worker API running and CORS including `http://localhost:5173`, status page shows health + auth OK when token is correct
- Wrong token shows auth failure without leaking the token
- Missing `CORS_ORIGINS` keeps API behavior unchanged for non-browser clients (Postman, curl)
