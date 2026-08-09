# Agentic Overlay Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure into an npm workspaces monorepo, then add Mongo-backed jobs/runs/overlays, recovery-only LLM learning (activate at 3), and a token-protected HTTP API embedded in the worker daemon.

**Architecture:** Shared domain in `@billing-agent/core`; CLI/scheduler in `@billing-agent/worker`; HTTP in `@billing-agent/api`; `apps/web` stub for a future UI. Coolify runs one process: worker `daemon` starts scheduler + API in-process.

**Tech Stack:** Node 20+, TypeScript, npm workspaces, Playwright, `@mistralai/mistralai`, `mongodb`, Node `http`, existing ntfy/commander/node-cron.

**Spec:** [2026-08-08-agentic-overlay-learning-design.md](../specs/2026-08-08-agentic-overlay-learning-design.md)

## Global Constraints

- kebab-case filenames; PascalCase for exported React/TS symbols inside files
- Package names: `@billing-agent/core`, `@billing-agent/worker`, `@billing-agent/api`
- Recovery: at most one LLM call + one retry per job run
- Never store plaintext secrets in MongoDB (env **names** only)
- No payment actions; scrape-only
- Auto-activate overlays at `successCount >= 3` (no human approve gate)
- MongoDB down → `ConfigError` fail-fast (no silent `jobs.json` fallback)
- HTTP: `Authorization: Bearer <API_TOKEN>`; `/health` unauthenticated
- UI out of scope beyond `apps/web/README.md` stub
- CI: mock Mongo/Mistral; no live Atlas or live TNPDCL

---

### Task 1: Monorepo reorg (behavior-preserving)

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json` (minimal stub exporting a placeholder until Task 7)
- Create: `apps/web/README.md`
- Modify: root `package.json` (workspaces + scripts)
- Modify: `Dockerfile`, `.dockerignore` as needed
- Move: existing `src/**` domain → `packages/core/src/**`
- Move: `cli.ts` + `scheduler.ts` → `apps/worker/src/`
- Move/adapt: `tests/**` to `packages/core/tests/**` (or root tests importing core) — prefer `packages/core/tests` colocated with core

**Target layout:**

```text
apps/worker/src/cli.ts
apps/worker/src/scheduler.ts
packages/core/src/{adapters,browser,captcha,config,errors,job-runner,logger,notify}.ts
apps/api/src/index.ts          # export empty startServer stub for now
apps/web/README.md
```

- [ ] **Step 1: Create workspace package.json files**

Root `package.json`:

```json
{
  "name": "billing-agent",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "npm run build -w @billing-agent/core && npm run build -w @billing-agent/api && npm run build -w @billing-agent/worker",
    "test": "npm run test -w @billing-agent/core",
    "dev": "npm run dev -w @billing-agent/worker",
    "start": "npm run start -w @billing-agent/worker",
    "postinstall": "playwright install chromium"
  },
  "engines": { "node": ">=20" }
}
```

`packages/core/package.json` name `@billing-agent/core`, `"type": "module"`, build with `tsc`, test with `tsx --test tests/**/*.test.ts`. Move current runtime deps that core needs (`playwright`, `@mistralai/mistralai`, etc.) into core; worker gets `commander`, `dotenv`, `node-cron`, and depends on `@billing-agent/core`.

- [ ] **Step 2: Move sources and fix imports**

Move files; update relative imports inside core. Worker CLI imports from `@billing-agent/core`. Keep public CLI commands identical: `run`, `daemon`.

- [ ] **Step 3: Update Dockerfile CMD**

```dockerfile
CMD ["node", "apps/worker/dist/cli.js", "daemon"]
```

Ensure build copies/builds all workspaces.

- [ ] **Step 4: Run tests**

Run: `npm test`  
Expected: PASS (same coverage as before reorg)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: split monorepo into core, worker, api, and web stub

EOF
)"
```

---

### Task 2: Mongo store + seed-jobs

**Files:**
- Create: `packages/core/src/store/types.ts`
- Create: `packages/core/src/store/mongo.ts`
- Create: `packages/core/tests/store-mongo.test.ts`
- Modify: `packages/core/src/config.ts` (load from Mongo; keep file parse for seed)
- Modify: `apps/worker/src/cli.ts` (`seed-jobs` command)
- Modify: `packages/core/package.json` (add `mongodb` dependency)
- Modify: `.env.example` (`MONGODB_URI`)

**Interfaces:**
- Produces:
  - `connectStore(uri: string): Promise<BillingStore>`
  - `BillingStore` with `getSettings`, `listJobs`, `getJob`, `upsertJob`, `upsertSettings`, `listActiveOverlays`, `recordOverlaySuccess`, `createRun`, `finishRun`, `listRuns`, `getRun`, `close`
  - Types: `JobDocument`, `SettingsDocument`, `OverlayDocument`, `RunDocument` per spec

- [ ] **Step 1: Write failing store tests** (mock collection or inject fake `Db`)

Assert `upsertJob` + `listJobs` round-trip shape; `recordOverlaySuccess` increments and flips to `active` at count 3.

- [ ] **Step 2: Implement `store/types.ts` + `store/mongo.ts`**

Collections: `jobs`, `settings`, `learned_overlays`, `runs`.

- [ ] **Step 3: Implement `seed-jobs --from <path>`**

Parse existing jobs JSON via current file parser; upsert into Mongo; require `MONGODB_URI`.

- [ ] **Step 4: Make `run` / `daemon` load AppConfig from Mongo**

If `MONGODB_URI` missing → `ConfigError`. Remove runtime dependence on `jobs.json` (keep `--from` for seed only).

- [ ] **Step 5: Tests green + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add Mongo store and seed-jobs for jobs and settings

EOF
)"
```

---

### Task 3: Overlay schema + merge

**Files:**
- Create: `packages/core/src/overlay.ts`
- Create: `packages/core/tests/overlay.test.ts`
- Modify: `packages/core/src/adapters/types.ts` — add `overlay?: SelectorOverlay` to `AdapterContext`

**Interfaces:**
- Produces:
  - `type SelectorOverlay = Record<string, string | string[]>`
  - `validateOverlayPatch(raw: unknown): SelectorOverlay` (throws on unknown keys / oversize)
  - `fingerprintFailure(input: { code: string; step?: string; urlPath?: string; title?: string }): string`
  - `mergeSelectors<T extends Record<string, string>>(defaults: T, overlay?: SelectorOverlay): T`

Allowed TNPDCL keys (lock in code): `username`, `password`, `captchaInput`, `captchaImage`, `loginButton`, `loginError`, plus field pattern keys `amount`, `dueDate`, `billPeriod`, `status`, `accountLabel` (string or string[] of regex sources).

- [ ] **Step 1: Failing tests** for validate reject, merge override, fingerprint stability
- [ ] **Step 2: Implement `overlay.ts`**
- [ ] **Step 3: Tests pass + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add overlay validation, fingerprinting, and selector merge

EOF
)"
```

---

### Task 4: Recovery module

**Files:**
- Create: `packages/core/src/recovery.ts`
- Create: `packages/core/tests/recovery.test.ts`
- Modify: reuse Mistral client patterns from `packages/core/src/captcha.ts`

**Interfaces:**
- Produces:
  - `type RecoveryDeps = { completeJson: (args: { system: string; user: string; imageBase64?: string }) => Promise<string> }`
  - `extractCompactDom(page: Page): Promise<string>` — ids, names, labels, buttons only; truncate (~8–12k chars)
  - `proposeOverlayPatch(input: { errorMessage: string; screenshotBase64?: string; compactDom: string; allowedKeys: string[] }, deps: RecoveryDeps): Promise<SelectorOverlay>`

- [ ] **Step 1: Failing tests** — mock `completeJson` returns valid/invalid JSON
- [ ] **Step 2: Implement recovery** — one shot; call `validateOverlayPatch`
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add Mistral one-shot overlay recovery

EOF
)"
```

---

### Task 5: Job-runner recovery + runs persistence

**Files:**
- Modify: `packages/core/src/job-runner.ts`
- Modify: `packages/core/tests/job-runner.test.ts`

**Interfaces:**
- Extends `RunnerDeps` with optional `store?: BillingStore`, `proposeOverlayPatch?: …`, `extractCompactDom?: …`
- Recoverable: `LoginError` | `ScrapeError` | `TimeoutError` only
- Flow: create run `running` → try adapter with active overlay → on recoverable fail → propose patch → retry once → `recordOverlaySuccess` if retry ok → `finishRun`

- [ ] **Step 1: Failing tests** — mock adapter fail then success on retry; assert `successCount` path; assert no recovery for `ConfigError`
- [ ] **Step 2: Implement wiring**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: wire overlay recovery and run records into job-runner

EOF
)"
```

---

### Task 6: Adapter overlay support

**Files:**
- Modify: `packages/core/src/adapters/tnpdcl.ts`
- Modify: `packages/core/src/adapters/dummy.ts`
- Modify: `packages/core/tests/dummy-adapter.test.ts` (or new test)

- [ ] **Step 1: Failing dummy test** — overlay changes which fixture selector/text is read
- [ ] **Step 2: Apply `mergeSelectors` / pattern overlays in TNPDCL + dummy**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: apply runtime selector overlays in tnpdcl and dummy adapters

EOF
)"
```

---

### Task 7: HTTP API in apps/api

**Files:**
- Create: `apps/api/src/auth.ts`
- Create: `apps/api/src/routes.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/tests/api.test.ts` (or `packages/core`/`apps/api` tests)
- Modify: `apps/worker/src/cli.ts` / `scheduler.ts` — daemon starts API; reload jobs on generation bump
- Modify: `.env.example` — `API_TOKEN`, `HTTP_PORT`

**Routes:** per spec (`/health`, `/runs`, `/runs/:id`, `/jobs` CRUD soft-delete).

- [ ] **Step 1: Failing tests** — 401 without bearer; `POST /jobs` then `GET /jobs`
- [ ] **Step 2: Implement server** with Node `http` + manual routing (no Express required)
- [ ] **Step 3: Daemon starts `startServer({ port, token, store })` alongside scheduler**
- [ ] **Step 4: Job write bumps `settings.jobsGeneration` (or equivalent); scheduler re-reads jobs when generation changes**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add token-protected HTTP API for runs and job CRUD

EOF
)"
```

---

### Task 8: Docs + Coolify

**Files:**
- Modify: `README.md` — workspace map, Mongo seed, API examples, Coolify port/healthcheck
- Modify: `.env.example`
- Modify: `Dockerfile` / Coolify notes in README
- Ensure: `apps/web/README.md` points at API for future UI

- [ ] **Step 1: Update docs/env**
- [ ] **Step 2: `npm test` + `npm run build`**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: document monorepo, Mongo, recovery overlays, and HTTP API

EOF
)"
```

---

## Verification (end-to-end)

- `npm test` and `npm run build` green with mocks only
- Manual: set `MONGODB_URI`, `seed-jobs --from jobs.example.json`, `run --job smoke-test`, `GET /runs` with bearer
- Manual: `POST /jobs` → appears in `GET /jobs`; daemon schedules it
- Optional: break a TNPDCL selector → one recovery call → candidate in `learned_overlays`

## Spec coverage checklist

| Spec item | Task |
| --- | --- |
| Monorepo layout | 1 |
| Mongo jobs/settings | 2 |
| Overlays activate at 3 | 2 + 5 |
| Recovery one-shot | 4–5 |
| Adapter overlays | 6 |
| Runs collection | 5 |
| HTTP API + auth | 7 |
| Coolify one process | 1 + 7 + 8 |
| web stub | 1 + 8 |
