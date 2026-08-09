# Vercel Static Web Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Netlify hosting config for `@billing-agent/web` with Vercel static SPA config and docs so operators can deploy from Root Directory `apps/web` with minimal dashboard setup.

**Architecture:** Keep the Vite SPA and direct `VITE_API_BASE_URL` + CORS model. Add `apps/web/vercel.json` (install from monorepo root, build to `dist`, SPA rewrite), delete `netlify.toml`, and point README / `.env.example` CORS examples at Vercel origins.

**Tech Stack:** Vite static output, Vercel project settings via `vercel.json`, npm workspaces

**Spec:** `docs/superpowers/specs/2026-08-09-vercel-static-web-design.md`

## Global Constraints

- Filenames: kebab-case only (workspace rule); `vercel.json` is a platform-mandated name
- No app code / auth / API client behavior changes
- No Vercel serverless, edge, or API proxy
- No Netlify support retained
- Vercel Root Directory remains `apps/web`
- `VITE_API_BASE_URL` stays an absolute origin with no trailing slash
- Root `postinstall` runs `playwright install chromium` — Vercel install must skip browser download

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/web/vercel.json` | Install/build/output + SPA rewrite for Vercel |
| `apps/web/netlify.toml` | Remove (Netlify no longer used) |
| `apps/web/README.md` | Local + Vercel deploy docs |
| `README.md` | Web UI hosting blurb + CORS example |
| `.env.example` | Example `CORS_ORIGINS` with Vercel URL |
| `apps/api/tests/api.test.ts` | CORS fixture origin string (Netlify → Vercel example) |

---

### Task 1: Vercel static config

**Files:**
- Create: `apps/web/vercel.json`
- Delete: `apps/web/netlify.toml`

**Interfaces:**
- Consumes: existing `apps/web` `npm run build` → `dist/`
- Produces: Vercel project config under Root Directory `apps/web`

- [ ] **Step 1: Create `apps/web/vercel.json`**

```json
{
  "installCommand": "cd ../.. && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Notes:
- `installCommand` runs with cwd = Root Directory (`apps/web`), so `cd ../..` reaches the monorepo root lockfile.
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` avoids the root `postinstall` Chromium download on Vercel (web does not need Playwright).
- If Vercel rejects `framework` / `buildCommand` / `outputDirectory` / `installCommand` as invalid project JSON, keep at least `rewrites` and document the other values in README as dashboard overrides — prefer the full in-file form when valid.

- [ ] **Step 2: Delete Netlify config**

```bash
rm apps/web/netlify.toml
```

- [ ] **Step 3: Verify production build still works**

Run: `npm run build -w @billing-agent/web`

Expected: exit 0; `apps/web/dist/index.html` exists.

- [ ] **Step 4: Commit**

```bash
git add apps/web/vercel.json
git rm apps/web/netlify.toml
git commit -m "$(cat <<'EOF'
chore(web): replace Netlify config with Vercel static SPA

EOF
)"
```

---

### Task 2: Docs and CORS examples

**Files:**
- Modify: `apps/web/README.md`
- Modify: `README.md` (Web UI section)
- Modify: `.env.example`
- Modify: `apps/api/tests/api.test.ts` (CORS example origins only)

**Interfaces:**
- Consumes: Task 1 `vercel.json` settings
- Produces: operator docs for Vercel Root Directory + env + CORS

- [ ] **Step 1: Replace the Netlify section in `apps/web/README.md`**

Keep the Local development and Scripts sections. Replace `## Netlify` with:

```markdown
## Vercel

Create a Vercel project linked to this repo:

- Root Directory: `apps/web`
- Config file: `vercel.json` (install from monorepo root, build `dist`, SPA rewrite)
- Env: `VITE_API_BASE_URL` (required), `VITE_API_TOKEN` (optional)
- On the API host, set `CORS_ORIGINS` to include the Vercel production origin (and preview origins if needed), e.g. `https://your-app.vercel.app`
```

- [ ] **Step 2: Update root `README.md` Web UI section**

Replace the current Web UI block with:

```markdown
## Web UI (`apps/web`)

Vite + React + Cleanplate SPA hosted on Vercel. Talks to the worker API via `VITE_API_BASE_URL` and Bearer token (`VITE_API_TOKEN` or session override).

```bash
npm run dev:web
```

On the API host, allow browser origins:

```bash
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

See `apps/web/README.md` for Vercel settings.
```

- [ ] **Step 3: Update `.env.example` CORS example**

Change:

```bash
CORS_ORIGINS=http://localhost:5173,https://your-app.netlify.app
```

to:

```bash
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

- [ ] **Step 4: Align API CORS test fixture origins with Vercel example**

In `apps/api/tests/api.test.ts`, replace `https://app.netlify.app` with `https://app.vercel.app` everywhere in the CORS describe block (allowlist array, request `Origin` header, and assertion).

- [ ] **Step 5: Verify no Netlify leftovers in active web/docs/env surfaces**

Run:

```bash
rg -n 'netlify|Netlify' apps/web README.md .env.example apps/api/tests/api.test.ts
```

Expected: no matches (historical files under `docs/superpowers/` may still mention Netlify; leave those alone).

- [ ] **Step 6: Run web + API tests**

Run:

```bash
npm run test -w @billing-agent/web && npm run test -w @billing-agent/api
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/README.md README.md .env.example apps/api/tests/api.test.ts
git commit -m "$(cat <<'EOF'
docs: switch web hosting docs from Netlify to Vercel

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Create `apps/web/vercel.json` (build/output + SPA rewrite) | 1 |
| Install from monorepo root | 1 (`installCommand`) |
| Delete `apps/web/netlify.toml` | 1 |
| Update `apps/web/README.md` | 2 |
| Update root `README.md` | 2 |
| Update `.env.example` CORS example | 2 |
| Preserve app / `VITE_*` behavior | (no code changes) |
| Build still produces `dist` | 1 Step 3 |
| Existing tests pass | 2 Step 6 |
