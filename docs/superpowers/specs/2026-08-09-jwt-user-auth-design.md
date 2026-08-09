# JWT User Authentication Design

**Date:** 2026-08-09  
**Status:** Approved for implementation planning  
**Related:** `2026-08-09-jobs-runs-ui-design.md`, `2026-08-09-web-api-shell-design.md`, `apps/api`, `apps/web`, `apps/worker`, `packages/core`

## Problem

The API and web app share a single static `API_TOKEN` Bearer secret. There are no portal users, no login, and jobs/runs are global. Operators need per-user access so each person’s jobs and runs stay private, while still provisioning accounts outside the UI (MongoDB Atlas).

## Goals

- Email (username) + password users stored in MongoDB
- JWT login for the web portal; Bearer JWT on all protected API routes
- All jobs and runs belong to a user (`userId`); HTTP list/get/mutate scoped to that user
- Public web route: `/login` only; all existing hubs behind a protected layout
- Provision users by inserting documents in Atlas (no register / forgot-password UI)
- One-time migration: assign existing orphan jobs/runs to a chosen user email
- Remove shared `API_TOKEN`, `VITE_API_TOKEN`, and TokenGate

## Non-goals

- Register, forgot-password, or invite UI
- User CRUD or password-reset HTTP APIs
- Roles / admin JWT / shared `API_TOKEN` bypass
- Refresh tokens or httpOnly cookie sessions
- Per-user settings, overlays, or scheduler isolation (daemon still runs all enabled jobs)
- Changing provider credential env-var model (`credentialsEnv`)

## Decisions

| Topic | Decision |
| --- | --- |
| Client token transport | Bearer JWT in `Authorization` header; store JWT in `sessionStorage` |
| User provisioning | Atlas UI insert only; document bcrypt hash helper CLI |
| Password reset / create user APIs | None |
| Replace `API_TOKEN` | Yes — daemon requires `JWT_SECRET` instead |
| Cross-user resource access | `404` (not `403`) |
| Legacy jobs/runs | Migration assigns missing `userId` to one existing user by email |
| Settings / TokenGate | Remove Settings hub and TokenGate; logout from AppShell |
| Login identity field | Email string, stored and matched lowercase |
| JWT claims | `{ sub: userId, email }`; expiry 7 days |
| Password hashing | bcrypt (`bcryptjs`); never store plaintext |
| JWT library | `jose` in `@billing-agent/api` |
| Scheduler | Unchanged — runs all enabled jobs regardless of owner |

## Architecture

```text
Browser (Vite SPA)                         Worker daemon
┌──────────────────────────────┐           ┌─────────────────────────────┐
│ /login (public)              │  JWT      │ HTTP API                    │
│ Protected: Jobs|Runs|Status  │ ────────► │ POST /auth/login            │
│ sessionStorage JWT + apiFetch│           │ jobs/runs scoped by userId  │
│ Logout in AppShell           │           │ Mongo: users, jobs, runs    │
└──────────────────────────────┘           └─────────────────────────────┘
```

### Data model

**`users` collection** (`UserDocument`):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | UUID |
| `email` | string | Unique, lowercase |
| `passwordHash` | string | bcrypt |
| `createdAt` | string | ISO timestamp |

**Jobs / runs:** add required `userId: string`.

- On `POST /jobs`, stamp `userId` from the JWT subject.
- On `createRun` (job runner), copy `job.userId` onto the run.
- Store `listJobs` / `listRuns` accept `userId` and filter; API rejects cross-user get/patch/delete/run with `404`.

Unique index on `users.email`.

### Atlas user insert shape

```json
{
  "id": "<uuid>",
  "email": "you@example.com",
  "passwordHash": "<bcrypt-hash>",
  "createdAt": "2026-08-09T00:00:00.000Z"
}
```

Generate `passwordHash` with the `hash-password` CLI (see Ops). Do not paste plaintext passwords into Atlas.

## API

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `GET` | `/health` | none | `{ ok: true }` |
| `POST` | `/auth/login` | none | Body `{ email, password }` → `{ token, user: { id, email } }` |
| * | `/jobs`, `/runs`, … | JWT | Existing shapes; always scoped to `userId` from token |

### Auth behavior

- Login: normalize email to lowercase; look up user; `bcrypt.compare`; on any failure return `401` with a generic message (no email enumeration).
- Missing/invalid/expired JWT → `401`.
- `StartServerInput` uses `jwtSecret: string` instead of `token: string`.
- Worker daemon reads `JWT_SECRET` (required); remove `API_TOKEN`.

### Ownership rules

- `GET /jobs`, `GET /runs` → only caller’s documents
- `GET|PATCH|DELETE /jobs/:id`, `POST /jobs/:id/run`, `GET /runs/:id` → if missing or `userId` mismatch → `404`
- Soft-disable and concurrent-run (`409`) behavior unchanged, after ownership check

## Web

| Path | Access | Purpose |
| --- | --- | --- |
| `/login` | public | Email + password form |
| `/`, `/jobs`, `/jobs/new`, `/jobs/:jobId`, `/runs`, `/runs/:runId`, `/status` | protected | Existing hubs |
| `/settings` | removed | TokenGate no longer used |

- Unauthenticated visit to a protected route → redirect to `/login` with return path in location state (`state.from`). After login, navigate to `from` or `/jobs`.
- Successful login → store JWT in `sessionStorage` → navigate to `/jobs` (or `next`).
- Logout → clear JWT → `/login`.
- `apiFetch`: attach Bearer JWT; on `401` clear JWT and redirect to `/login`.
- Drop `VITE_API_TOKEN` from web env; keep `VITE_API_BASE_URL`.
- Status page: health probe unchanged; auth probe = authenticated `GET /jobs` (no `/auth/me`).

## Ops

1. **`hash-password`** — CLI prints bcrypt hash for a plaintext password (for Atlas inserts / password changes in Atlas).
2. **`migrate-job-owners --email <email>`** — find user by email; set `userId` on all jobs and runs that lack `userId` (or have empty owner). Fail if user missing.
3. Document Atlas insert + migration in README.

## Edge cases

- Unknown email or wrong password → identical `401` body
- Expired JWT → `401`; web clears storage and sends user to login
- Disabled jobs remain listed for their owner only
- Email uniqueness enforced by index; inserts must use lowercase email
- Existing seed-jobs / fixtures must include `userId` after the type change

## Testing

- API: login success/fail; protected routes reject missing JWT; user A cannot read/mutate user B’s job/run (`404`); create job stamps `userId`; run inherits `userId`
- Store: `findUserByEmail`; list filters by `userId`
- Web: guard redirect; login success; 401 clears session; Settings/TokenGate gone
- Migration: orphans assigned to target user

## Success criteria

- Portal usable only after email/password login
- Each user’s jobs and runs are isolated over HTTP
- New users added only via Atlas (+ hash helper)
- No shared static API token for the web or job/run APIs

## Implementation plan

See `docs/superpowers/plans/2026-08-09-jwt-user-auth.md`.
