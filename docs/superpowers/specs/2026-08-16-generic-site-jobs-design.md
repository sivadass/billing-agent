# Generic Site Jobs Design

**Date:** 2026-08-16  
**Status:** Ready for team review (not approved for implementation)  
**Stack:** Node.js workspaces, TypeScript, Playwright (Chromium), Mistral, MongoDB, ntfy.sh / HTTPS webhooks, React/Vite web  
**Related:** `2026-08-08-billing-agent-design.md`, `2026-08-08-agentic-overlay-learning-design.md`, `2026-08-09-jobs-runs-ui-design.md`, `2026-08-11-price-monitor-design.md`  
**Plan:** `docs/superpowers/plans/2026-08-16-generic-site-jobs.md`

## Problem

The product is two parallel systems: named billing adapters (`tnpdcl`, `dummy`) plus a separate price-watch pipeline. Adding a new login portal means writing TypeScript. Operators cannot point the agent at an arbitrary Playwright-friendly site, describe the fields they want, and save a scheduled job.

We want one job model: configure a site through chat, confirm a sample extract, replay that workflow cheaply on a schedule, and see every run in the existing Runs hub.

## Feasibility

**Feasible** for sites Playwright can actually load (no hard bot wall), with a two-phase model: LLM + live browser **only while authoring**; deterministic replay on schedule; LLM recovery only when replay breaks.

**Not feasible / not in v1**

- Guaranteeing extraction on arbitrary websites
- Cloudflare / bank-grade anti-bot, app-only portals
- 2FA, SMS/email OTP, passkeys as a first-class path
- Full LLM browser agent on every cron tick
- Multi-tenant SaaS isolation, self-serve signup, or many concurrent Chromium processes
- Bill payment or any mutating action beyond login + read
- Horizontal worker fleet / message queue

“Scalable” in this spec means the **data model** can represent N arbitrary sites without new adapter files, still on one self-hosted VPS with sequential Chromium.

## Goals

- Chat: user provides a URL and what to fetch (price, bill amount, due date, …)
- If a login screen appears, the agent asks for credentials in the UI (not as plaintext chat)
- After the user confirms a sample extract, persist a job (workflow + secrets + notify + optional schedule)
- Per-job notify: user-supplied ntfy topic **or** webhook URL
- One Runs hub with today’s capabilities (list, filter, detail, live poll, recovery flags, screenshot path)
- Evolve the current monorepo; do not greenfield

## Non-goals (v1)

- LLM driving the browser on scheduled runs
- User-typed selector DSL as the primary setup path
- Generated / `eval`’d Playwright JavaScript
- WebSockets / SSE (polling only, same as runs)
- Overlay management UI
- Re-authoring an existing job from chat (“fix this job”) — user creates a new job
- Email / Slack notify channels
- DNS-rebinding-proof SSRF (block obvious private hosts; no resolve-then-connect race mitigation)
- Splitting API and worker into separate processes
- Dropping the TNPDCL TypeScript adapter on day one

## Decisions

| Topic | Decision |
| --- | --- |
| Execution model | Author once in chat; replay saved workflow; LLM only on authoring + recoverable replay failure |
| Scale | One Coolify process, sequential Chromium, JWT users as today |
| Rewrite shape | Evolve in place; unify jobs + watches; keep adapter engine for migrated TNPDCL/dummy |
| Workflow format | Ordered JSON steps (goto/fill/click/wait/captcha/extract/assert). No arbitrary JS |
| Secrets | AES-256-GCM in Mongo; host `SECRETS_MASTER_KEY`; never env-name maps for new jobs |
| Notify | Per-job ntfy topic or HTTPS webhook; global ntfy settings become defaults only |
| Runs | Single `runs` collection; `result` is a generic key/value map (replaces `billSummary` and `price_checks`) |
| Chat transport | REST + ~2s polling; screenshots via `tmp/` paths |
| Browser contention | At most one Chromium session: authoring **or** a job run, never both |
| New jobs | Created only by confirming a chat session (slice 3+). Slice 1–2 may still edit migrated jobs |
| Cron timezone | `Asia/Kolkata` (unchanged) |
| Canonical test site | Live [https://sivadass.in/](https://sivadass.in/) — extract contact email `contact@sivadass.in`. This replaces dummy-bill HTML as the workflow/chat/sign-off smoke. |
| Filenames | kebab-case |
| Dead code | Slice 5 deletes the price-watch dual stack only. Adapter engine (`tnpdcl` / `dummy`) and Mongo legacy coerce (`provider` → `adapterId`, `billSummary` → `result`) stay until TNPDCL is re-authored. No extra repo-wide unused-export sweep. |

## Architecture

```text
Browser SPA                         Worker host (one process)
┌─────────────────────────┐         ┌──────────────────────────────────┐
│ Chat | Jobs | Runs |    │  JWT    │ API                              │
│ Status                  │ ──────► │  jobs / runs / conversations     │
└─────────────────────────┘         │  POST /jobs/:id/run              │
                                    │  POST /conversations/:id/messages│
                                    └────────────┬─────────────────────┘
                                                 │
                                    ┌────────────▼─────────────────────┐
                                    │ Browser lock (one Chromium)      │
                                    │  authoring session  XOR  runJob  │
                                    │                                  │
                                    │ packages/authoring  (chat only)  │
                                    │ packages/core                    │
                                    │   workflow interpreter           │
                                    │   adapter engine (tnpdcl/dummy)  │
                                    │   secrets, notify, recovery      │
                                    │ scheduler (node-cron, IST)       │
                                    └──────────────────────────────────┘
```

### Two-phase lifecycle

1. **Authoring (chat):** live Playwright + Mistral tool loop → draft workflow + sample extract → user confirms → persist job, close browser.
2. **Replay (schedule / Run now):** load job + decrypt secrets → interpreter or adapter → write run → notify per `notify.on` → on `LoginError` / `ScrapeError` / `TimeoutError`, one overlay recovery attempt (slice 4). Zero LLM on the happy path.

## Data model

Canonical types live in `packages/core/src/store/types.ts`. Web may mirror a **subset** (never secrets ciphertext).

### `jobs`

Replaces today’s billing `JobDocument` **and** `WatchDocument`.

```ts
type FieldType = 'string' | 'number' | 'price' | 'date';

type ExtractField = {
  key: string;
  label: string;
  type: FieldType;
};

type NotifyOn = 'always' | 'change' | 'drop' | 'failure_only';

type NotifyChannel =
  | { type: 'ntfy'; topic: string; baseUrl?: string }
  | { type: 'webhook'; url: string };

type JobEngine = 'workflow' | 'adapter';

type JobDocument = {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  startUrl: string;
  engine: JobEngine;
  adapterId?: string; // required when engine === 'adapter'
  goal: string;
  schema: ExtractField[];
  workflow: WorkflowStep[]; // empty when engine === 'adapter'
  secretIds: string[];
  notify: {
    title: string;
    on: NotifyOn;
    channel: NotifyChannel;
  };
  lastResult: Record<string, string | number> | null;
  createdAt: string;
  updatedAt: string;
};
```

- Chat-created job ids: `{hostname-slug}-{4 hex}` (example: `tnebnet-org-a1b2`). `name` is display-only and editable.
- `startUrl` and webhook URLs must pass the public-URL SSRF helper (http/https, no credentials-in-URL, no localhost / private / link-local / cloud metadata / `.local` / `.internal`).
- `engine: 'adapter'` is a compatibility path only for migrated `tnpdcl` and `dummy`. New sites never get a new adapter file.

### `workflow` steps

No `eval`. Each step has a stable `id` so overlays can patch selectors later.

```ts
type WorkflowStep =
  | { id: string; type: 'goto'; url: string }
  | {
      id: string;
      type: 'fill';
      selector: string;
      source: 'secret' | 'literal';
      secretKey?: string;
      value?: string;
    }
  | { id: string; type: 'click'; selector: string }
  | { id: string; type: 'wait'; selector?: string; timeoutMs?: number }
  | {
      id: string;
      type: 'solve_captcha';
      imageSelector: string;
      inputSelector: string;
    }
  | {
      id: string;
      type: 'extract';
      fields: Array<{
        key: string;
        selector?: string;
        strategy?: 'text' | 'price' | 'json_ld' | 'shopify_json';
      }>;
    }
  | { id: string; type: 'assert'; selector: string; exists: true };
```

Scheduled `extract` does **not** call Mistral. Strategies are deterministic (`text`, `price` cascade, `json_ld`, `shopify_json`). LLM is used to **propose** selectors during authoring, not to scrape on cron.

Interpreter maps adapter `BillResult` into `result` for adapter-engine jobs:

`{ amount, dueDate?, billPeriod?, status?, accountLabel, rawNotes? }`

### `secrets`

Replaces `credentialsEnv` (field → env var name). Chat passwords cannot be env references. Values are **encrypted at rest** (AES-256-GCM), not merely base64-encoded — encoding is reversible without a key.

```ts
type SecretDocument = {
  id: string;
  userId: string;
  jobId: string | null;
  conversationId: string | null;
  key: string; // e.g. username, password
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes
  tag: string; // base64 GCM tag
  createdAt: string;
  updatedAt: string;
};
```

Host env keeps **one** wrapping key: `SECRETS_MASTER_KEY` (32-byte key, hex or base64). Per-site usernames/passwords live in Mongo, not in `.env`. Missing/invalid master key → `ConfigError` at encrypt/decrypt time, not at process boot.

#### Credential lifecycle (login sites)

```text
Chat sees login form
        │
        ▼
ask_secret → status awaiting_secret
        │
        ▼
UI password fields (not the message composer)
        │
        ▼
POST /conversations/:id/secrets
  encrypt → Mongo secrets (conversationId set, jobId null)
  transcript stores [secret:password] only
        │
        ▼
Agent decrypts once in worker memory, fills the live page, continues
        │
        ▼
User confirms job
  secrets.jobId = new job id
  workflow fill steps reference secretKey: "username" | "password"
        │
        ▼
Schedule / Run now
  decrypt in worker memory → page.fill → discard plaintext
        │
        ▼
Password change later
  PUT /jobs/:id/secrets  { values: { password: "…" } }
  re-encrypt in place; next run uses the new ciphertext
```

**Collect (chat):** The model must not ask the user to paste a password into the chat box. `ask_secret` names the keys (`username`, `password`, …). The SPA renders labelled inputs (`type="password"` where appropriate). `POST /conversations/:id/secrets` body `{ values: Record<string, string> }` is the only path that accepts plaintext.

**Persist:** Encrypt immediately. One `secrets` row per key. Same `key` on the same conversation/job is upserted (update on the fly), not duplicated.

**Retrieve (runs / live authoring):** Only the worker decrypts, in process memory, for `fill` steps with `source: 'secret'`. Plaintext is never written to runs, logs, screenshots metadata, or conversation messages. GC after the browser context closes.

**Retrieve (UI / API):** There is no “show me the password.” `GET /jobs/:id/secrets` returns `{ keys: [{ key, set: true }] }` only. Ciphertext, iv, and tag are never in HTTP responses.

**Update:** Write-only replace:

| Method | Path | When |
| --- | --- | --- |
| `POST` | `/conversations/:id/secrets` | Authoring, status `awaiting_secret` |
| `PUT` | `/jobs/:id/secrets` | Saved job; body `{ values: Record<string, string> }` — encrypts each key, upserts by `(jobId, key)` |

Empty string for a key is rejected (400). Omitting a key leaves the existing ciphertext. Job edit UI: “Username: set” / “Password: set” plus optional new fields; submitting a new value calls `PUT`.

**Scope:** Secrets are owned by `userId`. Cross-user GET/PUT → 404 (same as jobs).

**Loss of `SECRETS_MASTER_KEY`:** Decrypt fails; user re-enters via `PUT /jobs/:id/secrets`. No key-rotation ceremony in v1.

**Migrate:** One-time copy of current env credential values into encrypted `secrets` rows; after that, adapter jobs also read secrets, not `TNPDCL_PASSWORD`.

### `runs`

One history for billing and former price checks.

```ts
type RunDocument = {
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

`provider` and `billSummary` are removed. UI shows `engine` / `adapterId` and renders `result` as key/value.

### `conversations`

```ts
type ConversationStatus =
  | 'active'
  | 'awaiting_secret'
  | 'confirming'
  | 'saved'
  | 'abandoned'
  | 'expired';

type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  screenshotPath?: string;
  createdAt: string;
};

type ConversationDocument = {
  id: string;
  userId: string;
  status: ConversationStatus;
  jobId: string | null;
  startUrl: string | null;
  goal: string | null;
  messages: ConversationMessage[];
  draftWorkflow: WorkflowStep[] | null;
  draftSchema: ExtractField[] | null;
  draftExtract: Record<string, string | number> | null;
  draftNotify: JobDocument['notify'] | null;
  createdAt: string;
  updatedAt: string;
};
```

The Playwright browser for a conversation is **process-local** (in-memory map keyed by conversation id). It is not stored in Mongo. Worker restart → mark in-flight conversations `expired` and tell the user to start over.

### `learned_overlays`

Keep the collection and 3-success activation rule. Patch keys become **workflow step ids and/or extract field keys** (`step:<id>.selector`, `field:<key>`), not `tnpdclOverlayKeys`. Adapter-engine jobs may still use named adapter keys until TNPDCL is re-authored.

### `settings`

```ts
type SettingsDocument = {
  id: 'default';
  ntfy: {
    baseUrl: string;
    priority: string;
    /** Optional fallback when a job channel omits baseUrl */
    defaultTopic?: string;
  };
  mistral: {
    apiKeyEnv: string;
    model: string;
  };
  browser: {
    headless: boolean;
    timeoutMs: number;
    saveErrorScreenshot: boolean;
    noSandbox?: boolean;
  };
  jobsGeneration: number;
};
```

Drop `watchesGeneration` and `ntfy.topicEnv` as required fields. Per-job channel is authoritative.

### Dropped after migration

- `watches` collection
- `price_checks` collection
- `JobDocument.provider` / `credentialsEnv`
- Parallel watch scheduler

## Notify

Evaluate **after** a terminal run status:

| `notify.on` | Success | Failure |
| --- | --- | --- |
| `always` | send | send (high priority for ntfy) |
| `change` | send only if `result` differs from `lastResult` (JSON stringify of schema keys). First success = baseline, no success notify | send |
| `drop` | send only if schema has a `price` field, same currency (if present), and new price `<` previous. First success = baseline. Currency change = baseline reset, no success notify | send |
| `failure_only` | skip | send |

**ntfy:** POST text body of schema fields (`Label: value` lines). Title = `notify.title`. Failure title: `{notify.title} failed` (stop using the hardcoded `Billing agent failed:` prefix). One retry on 5xx/network.

**webhook:** POST JSON, `Content-Type: application/json`:

```json
{
  "jobId": "…",
  "runId": "…",
  "status": "success",
  "result": { "amount": "₹1,234" },
  "error": null
}
```

On failure, `result` is null and `error` is `{ "code": "ScrapeError", "message": "…" }`. One retry on 5xx/network. No HMAC in v1.

Webhook URL must pass the same public-URL SSRF helper as `startUrl`.

Adapter jobs that return `notify: false` (TNPDCL empty group-pay) still skip **success** notify regardless of `notify.on`. Failures still notify.

## Browser lock

Process-local mutex:

- `tryAcquire({ kind: 'run' | 'authoring', id })` → boolean
- `release(id)`
- `current()` → `{ kind, id } | null`

API:

- Run now while authoring or another run holds the lock → **409** `{ error: 'Browser busy' }`
- Start/continue authoring while a run holds the lock → **409** `{ error: 'Browser busy' }`
- Existing per-job “already running” **409** remains

Cron skips a tick if the lock is held (log + do not start a run). UI copy: “Browser is busy with another session.”

## Chat authoring (slice 3)

### Loop

1. User opens Chat, sends start URL + goal, optional schedule and notify channel.
2. `POST /conversations` creates `active` conversation; worker acquires browser lock, launches Chromium, `goto` startUrl.
3. Agent tools (strict JSON schemas): `snapshot` (accessibility tree + screenshot), `click`, `fill`, `wait`, `extract_candidates`, `ask_secret`, `propose_job`.
4. Login / password field → `ask_secret` → status `awaiting_secret`. UI shows labelled fields. `POST /conversations/:id/secrets` encrypts values; assistant message records placeholders only.
5. Agent extracts a sample → `propose_job` → status `confirming`. UI shows sample key/values + draft schema.
6. User confirms → persist job (`engine: 'workflow'`), attach secrets, bump `jobsGeneration`, status `saved`, release browser.
7. User rejects → stay `active` and continue, or abandon.

Max **20** tool turns per user message and **40** per conversation. Exceeding that → assistant asks the user to simplify or abandon. Do not loop forever.

### API

All routes JWT + `userId` scoped (404 on cross-user, same as jobs).

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/conversations` | Body: `{ startUrl, goal, schedule?, notify? }`. Returns conversation. Starts browser asynchronously if `onAuthorConversation` is configured; else **503**. |
| `GET` | `/conversations/:id` | Full document **without** secret values. Client polls ~2s while `active` / `awaiting_secret` / `confirming`. |
| `POST` | `/conversations/:id/messages` | Body: `{ text }`. Enqueues next agent turn. **409** if status is not `active`. |
| `POST` | `/conversations/:id/secrets` | Body: `{ values: Record<string, string> }`. Only when `awaiting_secret`. Encrypts/upserts. Then status → `active` and agent continues (fills the live page from decrypted secrets). |
| `GET` | `/jobs/:id/secrets` | `{ keys: [{ key, set: true }] }` — no values. |
| `PUT` | `/jobs/:id/secrets` | Body: `{ values: Record<string, string> }`. Encrypt upsert by `(jobId, key)`. **409** if a run for this job is `running`. |
| `POST` | `/conversations/:id/confirm` | Only when `confirming`. Creates job, returns `{ jobId, conversationId }`. |
| `POST` | `/conversations/:id/abandon` | Status `abandoned`; release browser if held. |

`startServer` gains `onAuthorConversation?: (conversationId: string) => Promise<void>` (fire-and-forget after create, analogous to `onRunJob`).

### Web

Hubs: **Chat | Jobs | Runs | Status**. Remove Price watches after slice 5.

- `/chat` — new conversation composer
- `/chat/:conversationId` — thread, secret form, confirm card, screenshot thumbs
- Jobs table: Name, Engine, Enabled, Schedule, Notify, Actions (Run now / Edit / Disable)
- Job edit: name, schedule, enabled, notify title / on / channel. Not provider, not credentialsEnv. Secrets panel: which keys are set, write-only inputs, `PUT /jobs/:id/secrets`.
- Run detail: render `result` key/value instead of bill-only fields. Keep recovery flags and screenshot path.

## Package layout

```text
packages/core/          # store, secrets, workflow interpreter, extract strategies,
                        # browser, lock, captcha, notify channels, recovery, adapters
packages/authoring/     # conversation agent + tools + in-memory browser session
                        # worker imports this; job replay must not
packages/price-monitor/ # removed in slice 5; extractors move into core in slice 2
apps/api/
apps/worker/
apps/web/
```

Import rules: `apps/*` may depend on core and authoring. `core` must not import `authoring` or `apps/*`. `authoring` may import `core`. Replay path (`job-runner` / interpreter) must not import `authoring`.

## Migration

CLI: `billing-agent migrate-generic-jobs`

Idempotent. For each user:

**Billing jobs**

- `engine: 'adapter'`, `adapterId: provider`
- `name` ← `notify.title` or `id`
- `startUrl` ← adapter default (TNPDCL login URL; dummy fixture path / URL)
- `goal` ← `notify.title`
- `schema` ← amount, dueDate, billPeriod, status, accountLabel
- `workflow: []`
- `notify.on: 'always'` unless known quiet dummy
- `notify.channel` ← `{ type: 'ntfy', topic }` from current resolved global topic
- Copy each `credentialsEnv` value from process env into a `secrets` row; fill `secretIds`
- `createdAt` / `updatedAt` now
- Keep `id`, `userId`, `enabled`, `schedule`

**Watches**

- New job id: keep watch `id` (jobs and watches already share string ids in different collections; after copy, delete watch)
- `engine: 'workflow'`
- `startUrl` ← watch url
- `name` ← title or hostname
- `schema`: `{ key: 'price', type: 'price' }`, `{ key: 'currency', type: 'string' }`
- `workflow`: `goto` + `extract` with `strategy: 'shopify_json'` then fallbacks encoded as one extract step with strategy `price` (interpreter tries the existing extract pipeline)
- `notify.on: 'drop'`
- `lastResult` from `lastPrice` / `lastCurrency`
- Each `price_checks` row → `runs` row (`result` / `error`, `status`, timestamps). `recovery*` false. Then delete `price_checks`.

**Runs**

- Existing billing runs: `billSummary` → `result`; `provider` → `adapterId`; `engine: 'adapter'`

**Settings**

- Copy `ntfy.baseUrl` / `priority`; drop required `topicEnv`
- Drop `watchesGeneration`; keep `jobsGeneration`

Do not delete old collections until slice 5. Slice 1 dual-reads if needed so the app boots; after migrate, code reads only the new shape.

## Recovery (slice 4)

Unchanged budget: one Mistral call, one retry, activate overlay after 3 matching successes.

Allowed overlay keys = union of the job’s workflow selector-bearing step ids and extract field keys (plus adapter keys when `engine === 'adapter'`).

Do not recover `ConfigError`, `NotifyError`, `CaptchaError`. Captcha stays vision OCR with one retry inside `solve_captcha`.

v1 does not offer chat “fix this job.” If recovery fails, the run fails and the user authors a new job.

## Canonical test site

Public, no login. CI **may** open this URL (outbound HTTPS required). Still **no** live TNPDCL and **no** live Mistral in CI.

| Field | Value |
| --- | --- |
| `startUrl` | `https://sivadass.in/` |
| Goal | Grab the contact email address |
| Schema | `{ key: 'email', label: 'Email', type: 'string' }` |
| Expected | `contact@sivadass.in` (trim; compare case-insensitive) |
| Example job id | `sivadass-in-email` |

Example workflow (selectors may be refined once Playwright sees the live DOM; assertion is on the extracted value, not a frozen selector):

```ts
[
  { id: 'goto-home', type: 'goto', url: 'https://sivadass.in/' },
  {
    id: 'extract-email',
    type: 'extract',
    fields: [{ key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' }],
  },
]
```

The dummy **adapter** stays only so migrated `engine: 'adapter'` jobs and adapter-engine unit tests still boot without TNPDCL. It is not the rewrite’s smoke target.

Login / password / captcha interpreter tests still need a **small local HTML fixture** (the portfolio has no login). That fixture is not the product smoke.

## Testing

| Area | Coverage |
| --- | --- |
| Types / migrate | Old job + watch fixtures → new documents; secrets encrypted; credentials not left in job JSON |
| Interpreter (smoke) | Playwright `goto https://sivadass.in/` → extract `email` === `contact@sivadass.in` |
| Interpreter (login path) | Local HTML only: fill from secret; captcha step calls solver |
| Notify | ntfy vs webhook; `always` / `drop` / `change` / `failure_only`; SSRF reject localhost webhook |
| Browser lock | Run + authoring contention → 409; lock released in `finally` |
| API | Conversation state machine; confirm creates job; secrets omitted from GET |
| Web | Chat poll stops on `saved`/`expired`; confirm navigates to job; runs render generic `result` |
| Adapter compat | Migrated dummy adapter still runs in CI (engine path only); TNPDCL manual |
| Authoring | Tool-loop unit tests with mocked page/LLM. Manual chat uses sivadass.in (no secret). No live Mistral in CI |

## Success criteria

1. After migrate, existing TNPDCL and dummy **adapter** jobs still run via `engine: 'adapter'`; former watches appear as jobs and their history appears under Runs.
2. Workflow job `sivadass-in-email` against [https://sivadass.in/](https://sivadass.in/) extracts `email` = `contact@sivadass.in`, writes a run, and notifies via ntfy **or** a test webhook.
3. Chat against `https://sivadass.in/`: agent proposes extract of the contact email → user confirms → saved job → Run now succeeds **without** calling the authoring LLM. (No login on this site; secret prompt is covered by the local login fixture unit tests.)
4. Runs hub lists adapter, workflow, and former price-check history with the same filter/detail/poll behavior.
5. Two Chromium users of the lock cannot overlap; the second caller gets 409 or a skipped cron tick.
6. `npm run test` covers migrate, interpreter (live sivadass.in smoke + local login-path), notify channels, lock, and conversation state machine. No live TNPDCL in CI.

## Implementation notes

- ESM + `tsc` to `dist/` as today. `tsx` for tests/dev.
- New env: `SECRETS_MASTER_KEY` in `.env.example` and README. Generate with `openssl rand -hex 32`.
- Product copy may stay “Billing agent” in the header for v1; jobs are generic. Optional later rename is out of scope.
- Respect site terms; personal read-only automation only.
- CI interpreter smoke opens [https://sivadass.in/](https://sivadass.in/) (needs outbound HTTPS). If that host is down, the smoke test fails — that is accepted for this personal site.
- Deliver as five shippable slices (see the plan). Do not start chat authoring until the interpreter can replay a saved workflow.
