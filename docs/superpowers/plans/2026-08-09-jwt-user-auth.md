# JWT User Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shared `API_TOKEN` with per-user JWT login (email/password in Mongo), scope all jobs/runs to `userId`, and protect the web app behind `/login`.

**Architecture:** bcrypt users in a `users` collection; `POST /auth/login` issues a Bearer JWT signed with `JWT_SECRET`; API verifies JWT and scopes store access by `userId`. Web stores JWT in `sessionStorage`. Users are provisioned only via Atlas + `hash-password` CLI. Migration assigns orphan jobs/runs to one email.

**Tech Stack:** `jose` (`@billing-agent/api`), `bcryptjs` (`@billing-agent/core`), Node `http` API, Mongo via `@billing-agent/core`, React Router, Cleanplate, Vitest / `node:test`

**Spec:** `docs/superpowers/specs/2026-08-09-jwt-user-auth-design.md`

## Global Constraints

- Filenames: kebab-case only; React export names may be PascalCase
- No register / forgot-password / user-CRUD / password-reset HTTP APIs
- No `API_TOKEN` / `VITE_API_TOKEN` / TokenGate after this work
- Cross-user job/run access returns **404**
- Email stored and matched **lowercase**
- JWT expiry **7 days**; claims `{ sub: userId, email }`
- Scheduler still runs all enabled jobs (HTTP isolation only)
- Credentials remain env **names** only (`credentialsEnv`)

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/core/src/store/types.ts` | `UserDocument`; `userId` on Job/Run; store method signatures |
| `packages/core/src/store/mongo.ts` | `users` collection; filter list by `userId`; user lookups |
| `packages/core/src/auth-password.ts` | Shared `hashPassword` / `verifyPassword` (bcryptjs) |
| `packages/core/src/job-runner.ts` | Stamp `userId` on `createRun` from job |
| `packages/core/tests/*` | Store + runner ownership tests |
| `packages/core/package.json` | Add `bcryptjs` (+ types) |
| `apps/api/package.json` | Add `jose` |
| `apps/api/src/auth.ts` | JWT verify; replace static bearer |
| `apps/api/src/jwt.ts` | Sign/verify access tokens with jose |
| `apps/api/src/server.ts` | `jwtSecret` instead of `token` |
| `apps/api/src/routes.ts` | `/auth/login`; scope jobs/runs; coerce `userId` |
| `apps/api/tests/api.test.ts` | Auth + isolation cases; MemoryStore users |
| `apps/worker/src/cli.ts` | `JWT_SECRET`; `hash-password`; `migrate-job-owners` |
| `apps/web/src/lib/auth-token.ts` | JWT sessionStorage only |
| `apps/web/src/lib/auth-api.ts` | `login()` helper |
| `apps/web/src/lib/api-client.ts` | 401 → clear + redirect |
| `apps/web/src/pages/login-page.tsx` | Login form |
| `apps/web/src/components/protected-route.tsx` | Auth gate |
| `apps/web/src/app.tsx` | Public login + protected shell; logout; drop Settings |
| Remove / stop using | `token-gate.tsx`, `settings-page.tsx` |
| `.env.example`, READMEs | `JWT_SECRET`; drop `API_TOKEN` / `VITE_API_TOKEN` |

---

### Task 1: Core types and store ownership

**Files:**
- Modify: `packages/core/src/store/types.ts`
- Modify: `packages/core/src/store/mongo.ts`
- Create: `packages/core/src/auth-password.ts`
- Modify: `packages/core/package.json` (bcryptjs)
- Modify: `packages/core/src/index.ts` (export `UserDocument`, password helpers)
- Modify: `packages/core/tests/store-mongo.test.ts` (and any MemoryStore fixtures)
- Modify: `packages/core/src/job-runner.ts`
- Modify: `packages/core/tests/job-runner.test.ts`

**Interfaces:**
- Produces:
  - `UserDocument = { id: string; email: string; passwordHash: string; createdAt: string }`
  - `JobDocument.userId: string`, `RunDocument.userId: string`
  - `BillingStore.findUserByEmail(email: string): Promise<UserDocument | null>`
  - `BillingStore.getUser(id: string): Promise<UserDocument | null>`
  - `BillingStore.listJobs(options?: { userId?: string }): Promise<JobDocument[]>`
  - `BillingStore.listRuns(options?: { userId?: string; jobId?: string; limit?: number }): Promise<RunDocument[]>`
  - Scheduler/daemon may call `listJobs()` without `userId` to see all jobs

- [ ] **Step 1: Extend types and shared password helpers**

Add `UserDocument`. Add `userId: string` to `JobDocument` and `RunDocument`. Update `BillingStore` method signatures as above. Keep `listJobs()` / `listRuns()` usable without `userId` for the daemon (return all when omitted).

```bash
npm install bcryptjs -w @billing-agent/core
npm install -D @types/bcryptjs -w @billing-agent/core
```

Create `packages/core/src/auth-password.ts` with `hashPassword` / `verifyPassword` (cost 10); export from the core barrel.

- [ ] **Step 2: Update mongo store**

In `connectStore` / `createBillingStoreFromCollections`, add `users: Collection<UserDocument>`. Implement `findUserByEmail` (query lowercase email), `getUser`. Filter `listJobs` / `listRuns` when `userId` provided. Create unique index on `users.email` at connect time.

- [ ] **Step 3: Job runner stamps run.userId**

When creating a run document, set `userId: job.userId`. Update tests/fixtures that build `JobDocument` / `RunDocument` to include `userId`.

- [ ] **Step 4: Run core tests**

Run: `npm test -w @billing-agent/core`  
Expected: PASS (update any broken fixtures first).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "$(cat <<'EOF'
feat(core): add users collection and job/run userId ownership

EOF
)"
```

---

### Task 2: API JWT auth and login

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/auth.ts`
- Create: `apps/api/src/jwt.ts` (sign/verify with jose)
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/tests/api.test.ts`

**Interfaces:**
- Consumes: `BillingStore.findUserByEmail`, job/run docs with `userId`
- Produces:
  - `StartServerInput.jwtSecret: string` (remove `token`)
  - `RouteContext = { jwtSecret: string; store; onRunJob?; authUser?: { id: string; email: string } }`
  - `requireJwtAuth(req, res, jwtSecret): { userId: string; email: string } | null`
  - `POST /auth/login` → `{ token: string; user: { id: string; email: string } }`

- [ ] **Step 1: Add jose dependency**

```bash
npm install jose -w @billing-agent/api
```

- [ ] **Step 2: Implement JWT helpers**

`apps/api/src/jwt.ts`: `signAccessToken({ userId, email, secret, expiresIn: '7d' })`, `verifyAccessToken(token, secret) => { userId, email }`. Import `verifyPassword` from `@billing-agent/core` for login.

- [ ] **Step 3: Replace auth middleware**

Rewrite `auth.ts` to parse `Authorization: Bearer <jwt>`, verify with `jwtSecret`, return claims or send `401` `{ error: 'Unauthorized' }` and return `null`.

- [ ] **Step 4: Wire login + scoped routes**

In `routes.ts`:
1. `GET /health` — unchanged, no auth
2. `POST /auth/login` — before JWT gate; read body; lowercase email; find user; verify password; sign JWT; generic `401` `{ error: 'Invalid email or password' }` on failure
3. For all other routes: `const user = requireJwtAuth(...); if (!user) return;`
4. Pass `userId: user.userId` into `listJobs` / `listRuns`
5. On get/patch/delete/run: load resource; if `!doc || doc.userId !== user.userId` → `404`
6. On create job: set `userId: user.userId` (ignore client-supplied `userId`)
7. Update `coerceJobDocument` to require/preserve `userId` from server, not client

Update `server.ts` to pass `jwtSecret`.

- [ ] **Step 5: Update API tests**

Extend `MemoryStore` with users map + `userId` filters. Helper to create user + login and get token. Cover:
- login success / wrong password
- jobs without JWT → 401
- user A cannot GET user B job → 404
- create job stamps `userId`

Run: `npm test -w @billing-agent/api`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "$(cat <<'EOF'
feat(api): JWT login and per-user job/run scoping

EOF
)"
```

---

### Task 3: Worker env + ops CLIs

**Files:**
- Modify: `apps/worker/src/cli.ts`
- Modify: `.env.example`
- Modify: root `README.md` (and `apps/web/README.md` auth bits)
- Modify: any seed-job fixtures that create `JobDocument` without `userId`

**Interfaces:**
- Produces:
  - `requireJwtSecret(env): string` replacing `requireApiToken`
  - CLI `hash-password <plaintext>` → prints bcrypt hash to stdout
  - CLI `migrate-job-owners --email <email>` → sets `userId` on jobs/runs missing it

- [ ] **Step 1: Daemon wiring**

Replace `token: requireApiToken()` with `jwtSecret: requireJwtSecret()`. Error message: `Missing environment variable: JWT_SECRET`.

- [ ] **Step 2: hash-password command**

```ts
program
  .command('hash-password')
  .argument('<password>')
  .action(async (password: string) => {
    const hash = await hashPassword(password);
    process.stdout.write(`${hash}\n`);
  });
```

Share bcrypt via `packages/core/src/auth-password.ts` (`hashPassword` / `verifyPassword`). Add `bcryptjs` (+ types) to `@billing-agent/core`; API and worker import from core. Do not add `bcryptjs` to `@billing-agent/api` directly.

- [ ] **Step 3: migrate-job-owners command**

```text
billing-agent migrate-job-owners --email you@example.com
```

Steps: connect store → `findUserByEmail` → if missing, exit 1 → updateMany jobs/runs where `userId` missing/null → print counts.

- [ ] **Step 4: Env + docs**

`.env.example`: replace `API_TOKEN=...` with `JWT_SECRET=replace-with-strong-random-secret`. Document Atlas user insert + hash-password + migrate in README.

- [ ] **Step 5: Commit**

```bash
git add apps/worker .env.example README.md apps/web/README.md packages/core
git commit -m "$(cat <<'EOF'
feat(worker): JWT_SECRET, hash-password, and job owner migration

EOF
)"
```

---

### Task 4: Web login and protected routes

**Files:**
- Modify: `apps/web/src/lib/auth-token.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/auth-api.ts`
- Create: `apps/web/src/pages/login-page.tsx`
- Create: `apps/web/src/pages/login-page.module.scss`
- Create: `apps/web/src/components/protected-route.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/pages/status-page.tsx`
- Modify: `apps/web/src/vite-env.d.ts`, `apps/web/.env.example`
- Delete or stop routing: `settings-page.tsx`, `token-gate.tsx` (and their tests; replace with login/guard tests)
- Modify: existing auth/token tests

**Interfaces:**
- Produces:
  - `TOKEN_STORAGE_KEY = 'billing-agent.jwt'`
  - `getAccessToken(): string | null` / `setAccessToken` / `clearAccessToken` (no env fallback)
  - `login(email, password): Promise<{ token; user }>`
  - `ProtectedRoute` children only if token present else `<Navigate to="/login" />`

- [ ] **Step 1: Token helpers + auth API**

Replace env-token resolution with sessionStorage JWT only. `auth-api.ts` posts to `/auth/login` via `apiFetch` (login call must work **without** requiring a prior token — ensure `apiFetch` allows missing Authorization).

- [ ] **Step 2: apiFetch 401 handling**

On response status 401 (except for the login request itself): `clearAccessToken()`; `window.location.assign('/login')` or navigate helper.

- [ ] **Step 3: Login page + protected layout**

`app.tsx` structure:

```tsx
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route element={<ProtectedRoute />}>
    <Route element={<AppShellLayout />}>
      <Route path="/" element={<Navigate to="/jobs" replace />} />
      <Route path="/jobs" element={<JobsPage />} />
      {/* jobs/new, jobs/:id, runs, runs/:id, status */}
    </Route>
  </Route>
  <Route path="*" element={<Navigate to="/jobs" replace />} />
</Routes>
```

Remove Settings from `MENU`. Add Logout control that clears token and navigates to `/login`.

- [ ] **Step 4: Status page**

Remove TokenGate / “Open Settings” empty state for missing token; rely on ProtectedRoute. Auth probe copy: JWT authorized for `/jobs`.

- [ ] **Step 5: Tests**

- auth-token: no `VITE_API_TOKEN` fallback
- login page submits and stores token (mock fetch)
- protected route redirects when logged out
- api-client 401 clears token

Run: `npm test -w @billing-agent/web`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
feat(web): JWT login page and protected routes

EOF
)"
```

---

### Task 5: End-to-end verification

**Files:** none new (manual + full test suite)

- [ ] **Step 1: Run monorepo tests**

```bash
npm test -w @billing-agent/core
npm test -w @billing-agent/api
npm test -w @billing-agent/web
```

Expected: all PASS

- [ ] **Step 2: Manual smoke (local)**

1. Set `JWT_SECRET` in `.env`; remove `API_TOKEN`
2. `hash-password '...'` → insert user in Atlas/local Mongo
3. `migrate-job-owners --email you@example.com` if legacy jobs exist
4. Start daemon + web; open `/jobs` → redirected to `/login`
5. Login → jobs hub; create job; confirm Mongo doc has `userId`
6. Logout → cannot access hubs

- [ ] **Step 3: Final docs pass**

Confirm README curl examples use login + JWT, not `API_TOKEN`.

- [ ] **Step 4: Commit** (docs-only fixes if any)

```bash
git add README.md apps/web/README.md
git commit -m "$(cat <<'EOF'
docs: update auth examples for JWT login

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| `users` + bcrypt + Atlas provisioning | 1, 3 |
| `POST /auth/login` + JWT | 2 |
| Jobs/runs `userId` + HTTP scoping | 1, 2 |
| Remove `API_TOKEN` / TokenGate / Settings | 3, 4 |
| Web `/login` + protected routes | 4 |
| `hash-password` + migrate owners | 3 |
| Cross-user 404 | 2 |
| Tests | 2, 4, 5 |
