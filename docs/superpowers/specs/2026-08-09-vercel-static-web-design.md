# Vercel Static Web Deploy Design

**Date:** 2026-08-09  
**Status:** Approved for implementation planning  
**Related:** `2026-08-09-web-api-shell-design.md`, `apps/web/README.md`

## Problem

`apps/web` is a Vite SPA configured for Netlify (`netlify.toml` + Netlify-oriented docs/CORS examples). Operators want to deploy the same static app on Vercel with minimal dashboard friction and no remaining Netlify coupling.

## Goals

- Replace Netlify hosting config with Vercel static SPA config under `apps/web`
- Keep Vercel Root Directory = `apps/web`, with install from monorepo root (root `package-lock.json`)
- Preserve existing client behavior: direct `VITE_API_BASE_URL` + Bearer token + API `CORS_ORIGINS`
- Update docs and env examples so CORS origins use Vercel URLs

## Non-goals

- Changing React/Vite app code, auth, or API client behavior
- Vercel serverless/edge functions or API proxy/BFF
- Deploying the worker/API on Vercel
- Supporting Netlify alongside Vercel
- Changing monorepo workspace layout

## Decisions

| Topic | Decision |
| --- | --- |
| Hosting | Vercel static SPA only; remove Netlify |
| Project root | Vercel Root Directory = `apps/web` |
| Install | `cd ../.. && npm ci` (lockfile lives at repo root) |
| Build / output | `npm run build` → `dist` |
| Framework | Vite (`framework: "vite"` in `vercel.json` when supported; otherwise omit and rely on Vercel Vite detection) |
| SPA routing | Rewrite all non-file routes to `/index.html` |
| Config location | `apps/web/vercel.json` (version-controlled) |
| Env vars | Unchanged: `VITE_API_BASE_URL` (required), `VITE_API_TOKEN` (optional) |
| API CORS | Operators add the Vercel production (and preview) origins to `CORS_ORIGINS` |

## Architecture

```text
Vercel (static SPA)                     Coolify / VPS
┌─────────────────────────┐             ┌──────────────────────────┐
│  @billing-agent/web     │  HTTPS +    │  worker daemon           │
│  Vite React + Cleanplate│  Bearer ──► │  + embedded HTTP API     │
│  VITE_API_BASE_URL      │             │  CORS_ORIGINS allowlist  │
└─────────────────────────┘             └──────────────────────────┘
```

Locally unchanged: `VITE_API_BASE_URL=http://127.0.0.1:8080` (or `HTTP_PORT`).

## File changes

| Path | Action |
| --- | --- |
| `apps/web/vercel.json` | Create: build/output + SPA rewrite |
| `apps/web/netlify.toml` | Delete |
| `apps/web/README.md` | Replace Netlify section with Vercel deploy steps |
| `README.md` | Web UI hosting text: Netlify → Vercel |
| `.env.example` | Example CORS origin: `https://your-app.vercel.app` |

### `apps/web/vercel.json` (intended shape)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

If Vercel rejects top-level `buildCommand` / `outputDirectory` / `framework` in project `vercel.json` for this setup, keep `rewrites` in-file and document the same build/output values as dashboard overrides (Root Directory still `apps/web`). Prefer the in-file form when valid.

### Vercel project settings (documented, not committed secrets)

- Root Directory: `apps/web`
- Install Command: `cd ../.. && npm ci`
- Environment: `VITE_API_BASE_URL`, optional `VITE_API_TOKEN`
- On the API host: `CORS_ORIGINS` includes `https://<project>.vercel.app` and any preview origins needed

## Testing / verification

- `npm run build -w @billing-agent/web` still produces `apps/web/dist`
- Existing web unit tests unchanged and still pass
- Manual: after Vercel deploy, status page can call `/health` and `/jobs` when CORS allowlists the Vercel origin

## Success criteria

- No Netlify config or Netlify-first docs remain for `apps/web`
- A new Vercel project can deploy by setting Root Directory + Install Command and env vars
- SPA deep links fall back to `index.html`
- Browser → API path remains direct `VITE_API_BASE_URL` with CORS
