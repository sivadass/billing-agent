# Generic Site Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify billing jobs and price watches into one job/workflow/run model with encrypted secrets and per-job notify, then add chat authoring that saves a replayable workflow.

**Architecture:** Evolve the existing monorepo. `packages/core` owns types, secrets, workflow interpreter, extract strategies, notify channels, and the adapter compatibility engine. `packages/authoring` owns the chat tool loop and process-local browser sessions (replay must not import it). Worker remains one process (scheduler + embedded API). Sequential Chromium via a process-local browser lock.

**Tech Stack:** TypeScript ESM, Playwright Chromium, Mistral, MongoDB, node-cron (`Asia/Kolkata`), JWT API, React/Vite/Cleanplate, `tsx --test` / vitest per package

**Spec:** [docs/superpowers/specs/2026-08-16-generic-site-jobs-design.md](../specs/2026-08-16-generic-site-jobs-design.md)

## Global Constraints

- Filenames: kebab-case only (exported React components may be PascalCase)
- Do not `eval` or generate Playwright JavaScript; workflows are JSON steps only
- Replay (`job-runner` / interpreter) must not import `@billing-agent/authoring`
- `core` must not import `apps/*` or `authoring`
- Secrets: AES-256-GCM; API never returns ciphertext/iv/tag; chat logs store placeholders only
- One Chromium at a time (authoring XOR run)
- Cron timezone: `Asia/Kolkata`
- SSRF: public http(s) only for `startUrl` and webhook URLs (reuse price-monitor host rules)
- Adapter engine remains for migrated `tnpdcl` and `dummy` until a later cleanup
- Canonical workflow smoke: live `https://sivadass.in/` → extract `email` === `contact@sivadass.in` (CI needs outbound HTTPS). Dummy adapter is adapter-engine CI only, not this smoke.
- No live TNPDCL / live Mistral authoring in CI
- Five slices are independently shippable; do not start slice N+1 until N is done and tests pass
- Dead code: slice 5 deletes the watch/price-monitor stack only. Do not delete adapters or legacy Mongo coerce in this program. No extra unused-export audit.
- Do not commit unless the user explicitly asks

## File structure

| Path | Responsibility |
| --- | --- |
| `packages/core/src/store/types.ts` | `JobDocument`, `RunDocument`, `SecretDocument`, `ConversationDocument`, `SettingsDocument`, store methods |
| `packages/core/src/store/mongo.ts` | Collections: jobs, runs, secrets, conversations, learned_overlays, settings, users |
| `packages/core/src/secrets.ts` | encrypt/decrypt AES-256-GCM |
| `packages/core/src/assert-public-url.ts` | SSRF helper moved from price-monitor |
| `packages/core/src/browser-lock.ts` | Process-local mutex |
| `packages/core/src/workflow/types.ts` | `WorkflowStep` union |
| `packages/core/src/workflow/validate.ts` | Step schema validation |
| `packages/core/src/workflow/interpreter.ts` | Replay steps against a Playwright page |
| `packages/core/src/extract/` | Strategies moved from `packages/price-monitor` |
| `packages/core/src/notify.ts` | ntfy + webhook; generic result formatting |
| `packages/core/src/compare.ts` | `always` / `change` / `drop` / `failure_only` |
| `packages/core/src/job-runner.ts` | Engine switch, lock, runs, notify, recovery hook |
| `packages/core/src/overlay.ts` | Allowlist from workflow step ids (slice 4) |
| `packages/core/src/migrate-generic-jobs.ts` | Idempotent migrate CLI logic |
| `packages/authoring/` | Agent loop, tools, session map (slice 3) |
| `apps/worker/src/cli.ts` | `migrate-generic-jobs`; wire authoring + lock |
| `apps/worker/src/scheduler.ts` | Single `jobsGeneration`; skip tick if lock held |
| `apps/api/src/routes.ts` | Jobs/runs shape; conversation routes |
| `apps/web/src/` | Chat hub; jobs/runs without provider/watches (phased) |
| `packages/price-monitor/` | Removed in slice 5 |

---

# Slice 1 — Model, secrets, migrate, adapter still runs

Shippable when: migrated dummy **adapter** job still `run --job smoke-test` (engine path only); API GET jobs returns the new shape; secrets are not in job JSON; watches are copied into jobs but watch UI may still exist until slice 5.

### Task 1: Core types + store methods (no behavior change yet)

**Files:**
- Modify: `packages/core/src/store/types.ts`
- Modify: `packages/core/src/store/mongo.ts`
- Modify: `packages/core/tests/` (store/type tests if present; otherwise add `packages/core/tests/store-types.test.ts` only if you add runtime guards)
- Modify: `packages/core/src/config.ts` — stop requiring `credentialsEnv` / `provider`; accept new job fields; keep adapter seed compatible

**Interfaces (canonical — copy from spec, do not invent parallel names):**

```ts
export type JobEngine = 'workflow' | 'adapter';
export type FieldType = 'string' | 'number' | 'price' | 'date';
export type NotifyOn = 'always' | 'change' | 'drop' | 'failure_only';
export type NotifyChannel =
  | { type: 'ntfy'; topic: string; baseUrl?: string }
  | { type: 'webhook'; url: string };

export type ExtractField = { key: string; label: string; type: FieldType };

export type JobDocument = {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  startUrl: string;
  engine: JobEngine;
  adapterId?: string;
  goal: string;
  schema: ExtractField[];
  workflow: WorkflowStep[];
  secretIds: string[];
  notify: { title: string; on: NotifyOn; channel: NotifyChannel };
  lastResult: Record<string, string | number> | null;
  createdAt: string;
  updatedAt: string;
};

export type SecretDocument = {
  id: string;
  userId: string;
  jobId: string | null;
  conversationId: string | null;
  key: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: string;
  updatedAt: string;
};

export type RunDocument = {
  id: string;
  jobId: string;
  userId: string;
  engine: JobEngine;
  adapterId?: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  screenshotPath: string | null;
  recoveryAttempted: boolean;
  recoverySucceeded: boolean;
  overlayActivated: boolean;
  result: Record<string, unknown> | null;
};
```

Add to `BillingStore`: `upsertSecret`, `listSecrets({ userId, jobId?, conversationId? })` (return documents for internal use; API layer strips crypto fields), `deleteSecretsForJob`, conversation CRUD stubs can wait for slice 3 (`upsertConversation` / `getConversation` / `listConversations`).

Settings: `ntfy.topicEnv` optional; add optional `ntfy.defaultTopic`; remove required `watchesGeneration` (read as `?? 0` during dual-run if watch code still exists).

- [x] **Step 1:** Write `packages/core/tests/job-document.test.ts` asserting a fixture new-shape job is accepted by a `assertJobDocument(raw: unknown): JobDocument` helper (add the helper in `packages/core/src/store/assert-job.ts`).
- [x] **Step 2:** Run `npm run test -w @billing-agent/core -- tests/job-document.test.ts` — expect FAIL (helper missing).
- [x] **Step 3:** Implement `assertJobDocument` + update `JobDocument` / `RunDocument` / `SettingsDocument` / `BillingStore`.
- [x] **Step 4:** Update `mongo.ts` to read/write new fields. When reading a **legacy** job (`provider` present, no `engine`), map in the driver:

```ts
function coerceLegacyJob(raw: Record<string, unknown>): JobDocument {
  if (typeof raw.engine === 'string') {
    return assertJobDocument(raw);
  }
  return assertJobDocument({
    ...raw,
    name: raw.notify && typeof raw.notify === 'object'
      ? (raw.notify as { title?: string }).title ?? raw.id
      : raw.id,
    engine: 'adapter',
    adapterId: raw.provider,
    startUrl: '',
    goal: '',
    schema: [],
    workflow: [],
    secretIds: [],
    lastResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notify: {
      title: (raw.notify as { title: string }).title,
      on: 'always',
      channel: { type: 'ntfy', topic: '' },
    },
  });
}
```

Legacy runs: `billSummary` → `result`, `provider` → `adapterId`, `engine: 'adapter'`.

- [x] **Step 5:** Fix compile errors in job-runner/config/api by mapping `job.adapterId ?? job.provider` temporarily **only inside this task if needed**; prefer finishing Task 2–3 in the same slice so `provider` is gone from call sites.
- [x] **Step 6:** `npm run test -w @billing-agent/core` — existing tests updated to new job fixtures (`packages/core/tests/fixtures/jobs.valid.json`).

**Done when:** core compiles; dummy fixture job uses `engine: 'adapter'`, `adapterId: 'dummy'`.

### Task 2: Secrets encrypt/decrypt

**Files:**
- Create: `packages/core/src/secrets.ts`
- Create: `packages/core/tests/secrets.test.ts`
- Modify: `packages/core/src/index.ts` — export secrets helpers
- Modify: `.env.example` — `SECRETS_MASTER_KEY=`

**Interfaces:**

```ts
export function parseMasterKey(env: NodeJS.ProcessEnv): Buffer;
export function encryptSecret(plaintext: string, key: Buffer): {
  ciphertext: string;
  iv: string;
  tag: string;
};
export function decryptSecret(
  doc: Pick<SecretDocument, 'ciphertext' | 'iv' | 'tag'>,
  key: Buffer,
): string;
```

- Key: 32 bytes from `SECRETS_MASTER_KEY` (accept 64-char hex or 44-char base64). Else `ConfigError('Missing or invalid environment variable: SECRETS_MASTER_KEY')`.
- `createCipheriv('aes-256-gcm', key, iv)` with 12-byte random IV.

- [x] **Step 1:** Test round-trip and “wrong key throws”.
- [x] **Step 2:** Run test — FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Tests pass. Never log plaintext.

### Task 3: Job runner uses adapterId + decrypted secrets + generic result

**Files:**
- Modify: `packages/core/src/job-runner.ts`
- Modify: `packages/core/src/config.ts` — replace `resolveJobCredentials` with `resolveJobSecrets(job, store, env)`
- Modify: `packages/core/tests/job-runner.test.ts`
- Modify: `packages/core/src/notify.ts` — format success body from `Record<string, unknown>` + schema labels; failure title `{notify.title} failed`

**Interfaces:**

```ts
export async function resolveJobSecrets(
  job: JobDocument,
  store: BillingStore,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>>;
```

For `engine === 'adapter'`: `getAdapter(job.adapterId)`; map `BillResult` to `result` via:

```ts
export function billResultToRecord(result: BillResult): Record<string, unknown> {
  const record: Record<string, unknown> = {
    amount: result.amount,
    accountLabel: result.accountLabel,
  };
  if (result.dueDate) record.dueDate = result.dueDate;
  if (result.billPeriod) record.billPeriod = result.billPeriod;
  if (result.status) record.status = result.status;
  if (result.rawNotes) record.rawNotes = result.rawNotes;
  return record;
}
```

`createRun` must set `engine`, `adapterId`, `result: null` (not `provider` / `billSummary`).

Notify: resolve topic from `job.notify.channel` (ntfy) or skip webhook until slice 2 (if channel is webhook, **skip send** and log `notify skipped: webhook not implemented` only if you split — **prefer implementing webhook in slice 2 Task 6, not here**). Slice 1: if channel is ntfy with empty topic, fall back to `settings.ntfy.defaultTopic` or env `NTFY_TOPIC`.

- [x] Update job-runner tests: dummy success writes `result.amount`; no `billSummary`.
- [x] `npm run test -w @billing-agent/core`

### Task 4: Migrate CLI

**Files:**
- Create: `packages/core/src/migrate-generic-jobs.ts`
- Create: `packages/core/tests/migrate-generic-jobs.test.ts`
- Modify: `apps/worker/src/cli.ts` — `migrate-generic-jobs`
- Modify: `README.md` — one subsection documenting the command + `SECRETS_MASTER_KEY`

**Interfaces:**

```ts
export async function migrateGenericJobs(input: {
  store: BillingStore;
  env: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<{ jobsMigrated: number; watchesMigrated: number; runsMigrated: number }>;
```

Behavior (idempotent): skip jobs that already have `engine`. For legacy jobs, apply spec mapping; encrypt env credential values into `secrets`. For each watch, upsert a workflow job (workflow may be a single `extract` with `strategy: 'price'` even before interpreter exists — adapter runner must **ignore** workflow when `engine === 'adapter'` only; migrated watches are `engine: 'workflow'` and **will not run until slice 2**). Copy `price_checks` → `runs`. Do not delete watches until slice 5.

TNPDCL `startUrl`: `https://www.tnebnet.org/awp/login`. Dummy `startUrl`: `file://` fixture or existing dummy URL used by the adapter.

- [x] Unit test with in-memory fake store (do not require Mongo): one legacy tnpdcl job + one watch + one price_check → new documents.
- [x] Wire CLI:

```text
billing-agent migrate-generic-jobs
```

**Done when:** test passes; README lists `SECRETS_MASTER_KEY` and the migrate command.

### Task 5: API + web consume new job/run fields (adapter jobs only)

**Files:**
- Modify: `apps/api/src/routes.ts` — coerce create/patch to new `JobDocument`; GET runs return `result` not `billSummary`; add `GET`/`PUT /jobs/:id/secrets`
- Modify: `apps/api/tests/api.test.ts`
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/jobs-api.ts`, `runs-api.ts`
- Modify: `apps/web/src/pages/jobs-page.tsx`, `job-form-page.tsx`, `run-detail-page.tsx` and tests

Jobs table column **Provider** → **Engine** (`adapter:tnpdcl` or `workflow`). Job form: hide `credentialsEnv`; show read-only engine; notify title + ntfy topic fields; write-only secret inputs (`PUT /jobs/:id/secrets`). Keep watches UI working against old `/watches` until slice 5.

- [x] API tests: POST job with `engine: 'adapter'` succeeds; POST with unknown engine 400.
- [x] API tests: `PUT /jobs/:id/secrets` encrypts; `GET` returns `{ key, set: true }` only (no ciphertext). Second PUT of the same key updates ciphertext (upsert). Empty string → 400. Other user’s job → 404.
- [x] Web: run detail shows key/value from `result`.
- [x] `npm run test -w @billing-agent/api` and `npm run test -w @billing-agent/web`

**Slice 1 exit:** dummy adapter job runs in CI; types no longer mention `credentialsEnv` / `billSummary` / `provider` on `JobDocument` / `RunDocument`.

---

# Slice 2 — Workflow interpreter, extract strategies, notify channels, browser lock

Shippable when: `engine: 'workflow'` job against `https://sivadass.in/` extracts `email` = `contact@sivadass.in`, writes a run, notifies ntfy or webhook; lock serializes runs.

### Task 6: Public URL helper in core

**Files:**
- Create: `packages/core/src/assert-public-url.ts` (move from `packages/price-monitor/src/assert-public-url.ts`)
- Move tests to `packages/core/tests/assert-public-url.test.ts`
- Re-export from price-monitor for one slice so watches still compile

- [ ] Same assertions as today’s price-monitor tests.
- [ ] `npm run test -w @billing-agent/core`

### Task 7: Workflow validate + interpreter

**Files:**
- Create: `packages/core/src/workflow/types.ts`
- Create: `packages/core/src/workflow/validate.ts`
- Create: `packages/core/src/workflow/interpreter.ts`
- Create: `packages/core/tests/workflow-interpreter.test.ts`
- Fixture for **login/captcha only:** keep `fixtures/dummy-bill.html` (or a tiny `fixtures/login-extract.html`). Do **not** use it as the product smoke.
- Smoke: live `https://sivadass.in/`

**Interfaces:**

```ts
export function validateWorkflow(steps: unknown): WorkflowStep[];

export async function runWorkflow(input: {
  page: Page;
  steps: WorkflowStep[];
  secrets: Record<string, string>;
  captchaSolver: CaptchaSolver;
  timeoutMs: number;
}): Promise<Record<string, unknown>>;
```

Step semantics:

- `goto` — `page.goto(url, { waitUntil: 'domcontentloaded' })`. `url` must pass `assertPublicUrl` (https://sivadass.in/ is allowed). `file:` is allowed **only** when the path is under repo `fixtures/` (login-path tests).
- `fill` — `page.locator(selector).fill(secrets[secretKey] or value)`
- `click` — click locator
- `wait` — wait for selector or timeout
- `solve_captcha` — screenshot image locator → solver → fill input
- `extract` — for each field, `strategy: 'text'` → `innerText`; `price` / `json_ld` / `shopify_json` → call extract helpers (Task 8). Missing required schema key → `ScrapeError`
- `assert` — locator count > 0 or `LoginError` / `ScrapeError`

- [ ] Test (smoke, network): workflow `[goto https://sivadass.in/, extract mailto]`, `result.email` equals `contact@sivadass.in` (trim, case-insensitive).
- [ ] Test (local): fill with secret `password` never appears in thrown error messages.
- [ ] Interpreter does not import Mistral except via injected `captchaSolver`.

### Task 8: Move extract strategies into core

**Files:**
- Move `packages/price-monitor/src/extract.ts` and extractors into `packages/core/src/extract/`
- `packages/price-monitor` re-exports from core so watch runner still works
- Tests move to `packages/core/tests/extract-*.test.ts` (or keep running via price-monitor until slice 5)

`extract` step `strategy: 'price'` calls the existing cascade (shopify json → json-ld → og → selectors). Do not call LLM fallback inside scheduled workflow extract in v1 (avoids surprise token spend). LLM fallback stays available only if `strategy` is omitted **and** you explicitly add it later; **v1: no LLM in replay extract**.

### Task 9: Notify channels + compare

**Files:**
- Modify: `packages/core/src/notify.ts`
- Create: `packages/core/src/compare.ts`
- Tests: `packages/core/tests/notify.test.ts`, `packages/core/tests/compare.test.ts`

**Interfaces:**

```ts
export type NotifyDecision = 'send_success' | 'skip_success' | 'send_failure';

export function decideNotify(input: {
  on: NotifyOn;
  status: 'success' | 'failed';
  result: Record<string, unknown> | null;
  lastResult: Record<string, string | number> | null;
  schema: ExtractField[];
  adapterNotify?: boolean;
}): NotifyDecision;

export async function dispatchNotify(input: {
  channel: NotifyChannel;
  defaultNtfy: { baseUrl: string; priority: string };
  title: string;
  body: string;
  priority?: string;
  webhookPayload?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<void>;
```

Webhook: `POST` JSON spec payload; retry once; `assertPublicUrl(channel.url)` first.

Drop rule: find schema field with `type === 'price'`; numeric compare; currency key `currency` if present. Mirror price-monitor gates (`price <= 0` is a failed extract, not a drop).

- [ ] Tests for all four `on` values and webhook SSRF reject `http://127.0.0.1/`.

### Task 10: Browser lock + job-runner engine switch

**Files:**
- Create: `packages/core/src/browser-lock.ts`
- Create: `packages/core/tests/browser-lock.test.ts`
- Modify: `packages/core/src/job-runner.ts` — acquire lock in `runJob` `try/finally`
- Modify: `apps/api/src/routes.ts` — 409 `Browser busy` when `lock.current()` is set
- Modify: `apps/worker/src/scheduler.ts` — skip tick if lock held
- Modify: `apps/worker/src/cli.ts` — share one lock instance across scheduler, `onRunJob`, and later authoring

**Interfaces:**

```ts
export type BrowserLockOwner = { kind: 'run' | 'authoring'; id: string };

export function createBrowserLock(): {
  tryAcquire(owner: BrowserLockOwner): boolean;
  release(id: string): void;
  current(): BrowserLockOwner | null;
};
```

`runJob` for `engine === 'workflow'` calls `runWorkflow` instead of `getAdapter`.

- [ ] Test: second `tryAcquire` returns false; `release` then succeeds.
- [ ] Dummy **adapter** job in job-runner test still writes `result.amount` (engine path).
- [ ] Workflow job-runner test: `sivadass-in-email` extracts `contact@sivadass.in`.
- [ ] `npm run test` (core, api, worker).

**Slice 2 exit:** `jobs.example.json` includes job `sivadass-in-email` (`startUrl: https://sivadass.in/`, schema email); webhook notify unit-tested.

---

# Slice 3 — Chat authoring

Shippable when: chat against `https://sivadass.in/` can extract the contact email, show a sample, confirm, and produce a workflow job that Run now executes **without** the authoring LLM.

### Task 11: Conversation store + API state machine (no LLM)

**Files:**
- Modify: `packages/core/src/store/types.ts` — `ConversationDocument` as in spec
- Modify: `packages/core/src/store/mongo.ts`
- Create: `apps/api` conversation handlers (prefer `apps/api/src/conversation-routes.ts` if `routes.ts` is already large)
- Tests: `apps/api/tests/conversations.test.ts`

Routes from spec. `onAuthorConversation` optional → 503 if missing on POST create.

GET conversation strips nothing from messages except ensuring no secret plaintext (redact helper).

- [ ] Tests: confirm in `active` → 409; secrets in `active` → 409; confirm in `confirming` creates job with `engine: 'workflow'`, `secretIds` set, conversation `saved`.

### Task 12: `packages/authoring` agent loop

**Files:**
- Create workspace package `@billing-agent/authoring` (mirror price-monitor package.json/tsconfig)
- Create: `packages/authoring/src/session.ts` — Map conversationId → `{ browser, context, page }`
- Create: `packages/authoring/src/tools.ts` — tool JSON schemas
- Create: `packages/authoring/src/agent.ts` — turn loop
- Create: `packages/authoring/tests/agent.test.ts` — mocked Mistral + mocked page
- Modify: root `package.json` `build:server` / `test` to include authoring after core

**Interfaces:**

```ts
export type AuthoringToolName =
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'wait'
  | 'extract_candidates'
  | 'ask_secret'
  | 'propose_job';

export async function handleAuthoringTurn(input: {
  store: BillingStore;
  conversationId: string;
  lock: ReturnType<typeof createBrowserLock>;
  env: NodeJS.ProcessEnv;
  mistral: SettingsDocument['mistral'];
  browser: SettingsDocument['browser'];
}): Promise<void>;
```

Rules:

- Acquire `{ kind: 'authoring', id: conversationId }` or persist assistant text “Browser is busy with another session.” and return.
- Max 20 tool turns per user message, 40 per conversation.
- `ask_secret` sets status `awaiting_secret` and **returns** (do not continue until secrets POST).
- `propose_job` sets `draftWorkflow`, `draftSchema`, `draftExtract`, status `confirming`.
- Worker restart: `expireStaleAuthoringSessions()` marks conversations `expired` if status in `active|awaiting_secret|confirming` and no live session.

- [ ] Mocked test: LLM `ask_secret` → status awaiting_secret (local login fixture / mocked page).
- [ ] Mocked test: `propose_job` for sivadass.in email → confirming with `draftExtract.email`.
- [ ] No real Mistral in CI.

### Task 13: Wire worker + web Chat hub

**Files:**
- Modify: `apps/worker/src/cli.ts` — `onAuthorConversation` → `handleAuthoringTurn`
- Create: `apps/web/src/pages/chat-page.tsx`, `chat-page.module.scss`
- Create: `apps/web/src/lib/conversations-api.ts`
- Modify: `apps/web/src/app.tsx` — menu Chat first or after Jobs; routes `/chat`, `/chat/:conversationId`
- Tests: poll stops on `saved` / `expired`; confirm navigates to `/jobs/:jobId`

UI:

- Composer for start URL + goal + optional ntfy topic or webhook URL + optional cron (pre-fill example: `https://sivadass.in/` / “Grab the contact email”)
- Thread of messages; screenshot `<img>` from API-served tmp path **only if you already have static screenshot serving** — if not, show `screenshotPath` as text in v1 (do not add a file server as a blocker; optional `GET /runs/:id/screenshot` pattern can be reused)
- `awaiting_secret`: password inputs
- `confirming`: sample table + Confirm / Keep going

- [ ] `npm run test -w @billing-agent/web`
- [ ] Manual: chat `https://sivadass.in/` → confirm email `contact@sivadass.in` (document in `docs/local-testing-sign-off-guide.md`)

**Slice 3 exit:** confirming chat creates a job; Run now uses interpreter only.

---

# Slice 4 — Generalized overlay recovery

Shippable when: a workflow extract selector can be patched by recovery the same way TNPDCL overlays work today.

### Task 14: Overlay allowlist from workflow

**Files:**
- Modify: `packages/core/src/overlay.ts` — `allowedOverlayKeys(job: JobDocument): Set<string>`
- Modify: `packages/core/src/recovery.ts` / `job-runner.ts` — pass those keys instead of `tnpdclOverlayKeys` for workflow jobs; adapter jobs keep adapter key set
- Modify: `packages/core/tests/overlay.test.ts`, `recovery.test.ts`

Key format: `step:<stepId>.selector`, `step:<stepId>.imageSelector`, `field:<key>`.

Interpreter applies overlay: if patch has `step:abc.selector`, replace that step’s selector before run.

- [ ] Test: failed extract → mocked proposer returns `{ 'field:amount': '#new' }` → retry succeeds → `recordOverlaySuccess`.
- [ ] Captcha errors still not recovered.

---

# Slice 5 — Remove price-monitor dual stack

Shippable when: no `/watches` routes or Price watches nav; `packages/price-monitor` deleted; scheduler has a single generation; migrate deletes leftover `watches` / `price_checks` collections (or leaves them unused and undocumented).

### Task 15: Delete watch package and UI

**Files:**
- Delete: `packages/price-monitor/`
- Delete: `apps/web` watch pages, `watches-api.ts`, tests
- Modify: `apps/api/src/routes.ts` — remove `/watches`
- Modify: `apps/worker/src/scheduler.ts` — remove watch crons / `watchesGeneration`
- Modify: `apps/worker/src/cli.ts` — remove `run-watch` / `run-watches`
- Modify: root `package.json` workspaces scripts
- Modify: `README.md`, `watches.example.json` (delete or replace with workflow job example)
- Extend migrate to `drop` leftover collections after copy (guard: only if no watch remains unmigrated)

- [ ] `npm run test` and `npm run build` green.
- [ ] Grep the repo for `price-monitor`, `WatchDocument`, `/watches` — zero production references.

**In scope to delete:** watch package, watch UI/API/CLI/crons, `watches.example.json`, leftover watch collections after migrate.

**Out of scope (not dead yet):** `tnpdcl` / `dummy` adapters, `BillResult`, `coerceLegacyJob` / run `billSummary` mapping, `tnpdclOverlayKeys` for adapter jobs. Those go only after a later live re-author of TNPDCL, not in this program.

Optional follow-up (not this slice): re-author TNPDCL via chat and delete `packages/core/src/adapters/tnpdcl.ts`. Leave adapters until that is proven on a live bill.

---

## Manual sign-off (after slice 3+)

Use `docs/local-testing-sign-off-guide.md` (add a Generic jobs section):

1. `migrate-generic-jobs` on a copy of Atlas, not production first
2. Dummy adapter job Run now (engine compatibility only)
3. Workflow job against [https://sivadass.in/](https://sivadass.in/) extracts `contact@sivadass.in` + ntfy
4. Webhook job against a requestbin / local test server
5. Chat: URL `https://sivadass.in/`, goal “Grab my email address” → confirm `contact@sivadass.in` → Run now with no authoring LLM
6. Confirm lock: start chat, Run now → 409
7. Live TNPDCL adapter job still works (manual)

## Execution order reminder

Slice 1 (model) → 2 (interpreter) → 3 (chat) → 4 (recovery) → 5 (cleanup). Chat before interpreter would persist jobs nothing can replay.
