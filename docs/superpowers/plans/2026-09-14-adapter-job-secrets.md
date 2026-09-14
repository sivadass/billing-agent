# Adapter Job Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators add another TNPDCL login as a new job with labelled username/password fields, storing values encrypted per job instead of host env-name maps.

**Architecture:** Providers declare required secret keys in code. Mongo `secrets` rows hold AES-256-GCM ciphertext. The job runner decrypts into the existing `credentials` map; the tnpdcl adapter is unchanged. A boot migrate copies legacy `credentialsEnv` env values once, then unsets that field.

**Tech Stack:** Node.js workspaces, TypeScript ESM, MongoDB, `node:test` via `tsx --test` in core/api/worker, Vitest in web, Playwright adapters unchanged.

**Spec:** `docs/superpowers/specs/2026-09-14-adapter-job-secrets-design.md`

## Global Constraints

- Filenames: kebab-case only (workspace rule)
- One job = one login; no accounts collection or reusable profiles
- Adapter `run({ credentials })` stays unchanged
- Never log plaintext, ciphertext, or `SECRETS_MASTER_KEY` material
- `GET` job payloads never include `secrets`, ciphertext, or `credentialsEnv`
- Job field updates stay on existing `PATCH /jobs/:id` (do not add a second update verb); secrets use `PUT /jobs/:id/secrets`
- No live TNPDCL and no live Mistral in CI
- Do not implement chat authoring, workflows, or group-pay multi-consumer scrape

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/core/src/adapters/credential-keys.ts` | Provider → required secret keys; payload validation |
| `packages/core/src/secrets.ts` | `SECRETS_MASTER_KEY` parse + AES-256-GCM |
| `packages/core/src/migrate-job-secrets.ts` | Copy legacy env maps into secret rows; unset `credentialsEnv` |
| `packages/core/src/store/types.ts` | `SecretDocument`; optional legacy `credentialsEnv`; store methods |
| `packages/core/src/store/mongo.ts` | `secrets` collection + unique `(jobId, key)` index |
| `packages/core/src/config.ts` | Optional seed `credentials`; `resolveJobSecrets` |
| `packages/core/src/job-runner.ts` | Decrypt secrets instead of env maps |
| `apps/api/src/routes.ts` | `/providers`, create-with-secrets, GET/PUT secrets, strip `credentialsEnv` |
| `apps/web/src/pages/job-form-page.tsx` | Labelled write-only secret fields |
| `apps/worker/src/cli.ts` | Migrate after `connectStore` |

---

### Task 1: Provider credential schema

**Files:**
- Create: `packages/core/src/adapters/credential-keys.ts`
- Create: `packages/core/tests/credential-keys.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export const adapterCredentialKeys: Record<string, readonly string[]> = {
  tnpdcl: ['username', 'password'],
  dummy: [],
};

export function requiredCredentialKeys(provider: string): readonly string[] {
  return adapterCredentialKeys[provider] ?? [];
}

export function listAdapterProviders(): Array<{
  id: string;
  credentialKeys: string[];
}>;

/** Returns an error message, or null if valid. */
export function validateSecretPayload(
  provider: string,
  values: Record<string, string>,
  mode: 'create' | 'update',
): string | null;
```

- `create`: every required key present and non-empty; no unknown keys
- `update`: at least one key; every key allowed and non-empty; omitted keys OK
- Unknown provider: required/allowed keys are `[]` (extra keys fail)

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  listAdapterProviders,
  requiredCredentialKeys,
  validateSecretPayload,
} from '../src/adapters/credential-keys.ts';

describe('adapter credential keys', () => {
  it('lists tnpdcl username/password and dummy empty', () => {
    assert.deepEqual(listAdapterProviders(), [
      { id: 'tnpdcl', credentialKeys: ['username', 'password'] },
      { id: 'dummy', credentialKeys: [] },
    ]);
    assert.deepEqual(requiredCredentialKeys('tnpdcl'), ['username', 'password']);
    assert.deepEqual(requiredCredentialKeys('dummy'), []);
    assert.deepEqual(requiredCredentialKeys('unknown'), []);
  });

  it('validates create and update payloads', () => {
    assert.equal(
      validateSecretPayload(
        'tnpdcl',
        { username: 'u', password: 'p' },
        'create',
      ),
      null,
    );
    assert.match(
      validateSecretPayload('tnpdcl', { username: 'u' }, 'create') ?? '',
      /password/i,
    );
    assert.match(
      validateSecretPayload('tnpdcl', { username: 'u', password: '' }, 'create') ?? '',
      /empty/i,
    );
    assert.match(
      validateSecretPayload('tnpdcl', { username: 'u', extra: 'x' }, 'create') ?? '',
      /unknown/i,
    );
    assert.equal(
      validateSecretPayload('tnpdcl', { password: 'new' }, 'update'),
      null,
    );
    assert.match(
      validateSecretPayload('dummy', { username: 'u' }, 'create') ?? '',
      /unknown/i,
    );
    assert.equal(validateSecretPayload('dummy', {}, 'create'), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @billing-agent/core -- packages/core/tests/credential-keys.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

Keep `listAdapterProviders` iteration order **tnpdcl then dummy** (Object insertion order of `adapterCredentialKeys`). Empty string → `"secret key \"password\" must not be empty"`. Unknown → `"unknown overlay key"` is wrong; use `"unknown secret key: extra"`. Missing on create → `"missing secret key: password"`. Update with `{}` → `"overlay patch must not be empty"` style: `"secrets values must not be empty"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @billing-agent/core -- packages/core/tests/credential-keys.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters/credential-keys.ts packages/core/tests/credential-keys.test.ts packages/core/src/index.ts
git commit -m "feat: declare adapter credential keys for tnpdcl and dummy"
```

---

### Task 2: AES-256-GCM helpers

**Files:**
- Create: `packages/core/src/secrets.ts`
- Create: `packages/core/tests/secrets.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `.env.example` — add `SECRETS_MASTER_KEY=` (keep `TNPDCL_*` for migrate)

**Interfaces:**
- Consumes: `ConfigError`
- Produces:

```ts
export function parseMasterKey(env: NodeJS.ProcessEnv): Buffer;
export function encryptSecret(
  plaintext: string,
  key: Buffer,
): { ciphertext: string; iv: string; tag: string };
export function decryptSecret(
  doc: { ciphertext: string; iv: string; tag: string },
  key: Buffer,
): string;
```

- 32-byte key: 64-char hex **or** 44-char base64
- Else `ConfigError('Missing or invalid environment variable: SECRETS_MASTER_KEY')`
- `createCipheriv('aes-256-gcm', key, iv)` with 12-byte random IV; store iv/ciphertext/tag as base64
- Never `console.log` plaintext or the key

- [ ] **Step 1: Write the failing test**

Use a fixed hex key `'11'.repeat(32)` and a second key `'22'.repeat(32)`.

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decryptSecret,
  encryptSecret,
  parseMasterKey,
} from '../src/secrets.ts';
import { ConfigError } from '../src/errors.ts';

const hex = '11'.repeat(32);

describe('secrets', () => {
  it('round-trips plaintext', () => {
    const key = parseMasterKey({ SECRETS_MASTER_KEY: hex });
    const enc = encryptSecret('hunter2', key);
    assert.equal(decryptSecret(enc, key), 'hunter2');
  });

  it('throws ConfigError for missing or short keys', () => {
    assert.throws(() => parseMasterKey({}), (err) => err instanceof ConfigError);
    assert.throws(
      () => parseMasterKey({ SECRETS_MASTER_KEY: 'abcd' }),
      (err) => err instanceof ConfigError,
    );
  });

  it('throws when decrypting with the wrong key', () => {
    const a = parseMasterKey({ SECRETS_MASTER_KEY: hex });
    const b = parseMasterKey({ SECRETS_MASTER_KEY: '22'.repeat(32) });
    const enc = encryptSecret('hunter2', a);
    assert.throws(() => decryptSecret(enc, b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @billing-agent/core -- packages/core/tests/secrets.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement `packages/core/src/secrets.ts`**

Accept hex via `/^[0-9a-fA-F]{64}$/` → `Buffer.from(hex, 'hex')`. Else try `Buffer.from(value, 'base64')` and require `key.length === 32`. Use `randomBytes(12)` for IV. `cipher.setAuthTag` on decrypt.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @billing-agent/core -- packages/core/tests/secrets.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/secrets.ts packages/core/tests/secrets.test.ts packages/core/src/index.ts .env.example
git commit -m "feat: encrypt job secrets with AES-256-GCM"
```

---

### Task 3: Secrets collection on the store

**Files:**
- Modify: `packages/core/src/store/types.ts`
- Modify: `packages/core/src/store/mongo.ts`
- Modify: `packages/core/tests/store-mongo.test.ts`
- Modify every `implements BillingStore` stub: `apps/api/tests/api.test.ts`, `packages/authoring/tests/agent.test.ts`
- Modify full `BillingStore` object literals in `packages/core/tests/job-runner.test.ts` (add no-op `listSecrets` / `upsertSecret` / `unsetJobCredentialsEnv`)

**Interfaces:**
- Consumes: encrypt helpers (not required inside mongo — store persists already-encrypted docs)
- Produces:

```ts
export type SecretDocument = {
  id: string;
  userId: string;
  jobId: string;
  key: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: string;
  updatedAt: string;
};

// JobDocument.credentialsEnv becomes optional (legacy until migrate unsets it)

listSecrets(jobId: string): Promise<SecretDocument[]>;
upsertSecret(doc: SecretDocument): Promise<void>; // unique on (jobId, key); update ciphertext/iv/tag/updatedAt
unsetJobCredentialsEnv(jobId: string): Promise<void>; // $unset credentialsEnv
```

Extend mongo `Update` type with `$unset?: Record<string, ''>`.

`connectStore`: `db.collection<SecretDocument>('secrets')` and `createIndex({ jobId: 1, key: 1 }, { unique: true })`.

`createBillingStoreFromCollections` gains `secrets: CollectionLike<SecretDocument>`.

- [ ] **Step 1: Write the failing store test**

In `packages/core/tests/store-mongo.test.ts`, pass a `secrets` memory collection into `createStore()`. Add:

```ts
  it('upserts secrets by jobId+key and lists them', async () => {
    const { store } = createStore();
    const first: SecretDocument = {
      id: 'sec-1',
      userId: 'user-1',
      jobId: 'home-eb',
      key: 'password',
      ciphertext: 'c',
      iv: 'i',
      tag: 't',
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    };
    await store.upsertSecret(first);
    await store.upsertSecret({
      ...first,
      ciphertext: 'c2',
      updatedAt: '2026-09-14T01:00:00.000Z',
    });
    const rows = await store.listSecrets('home-eb');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.ciphertext, 'c2');
  });

  it('unsets legacy credentialsEnv', async () => {
    const { store } = createStore();
    await store.upsertJob({
      id: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      credentialsEnv: { username: 'TNPDCL_USERNAME' },
      notify: { title: 'Bill' },
    });
    await store.unsetJobCredentialsEnv('home-eb');
    const job = await store.getJob('home-eb');
    assert.equal(job?.credentialsEnv, undefined);
  });
```

Make existing job fixtures compile by leaving `credentialsEnv` or omitting it once the field is optional.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @billing-agent/core -- packages/core/tests/store-mongo.test.ts`

Expected: FAIL (methods missing)

- [ ] **Step 3: Implement types + mongo + stubs**

`upsertSecret`: `updateOne({ jobId, key }, { $set: { ...doc }, $setOnInsert: { id, createdAt } }, { upsert: true })` — simplest: findOne then insertOne or updateOne `$set` ciphertext/iv/tag/updatedAt. Preserve original `id` on update.

API `MemoryStore`: `secrets = new Map<string, SecretDocument>()` keyed by `${jobId}\0${key}`.

Authoring stub: `async listSecrets() { return []; }` / `async upsertSecret() {}` / `async unsetJobCredentialsEnv() {}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @billing-agent/core -- packages/core/tests/store-mongo.test.ts`

Also: `npm test -w @billing-agent/api`. If `packages/authoring/tests/agent.test.ts` fails to typecheck because `AuthoringMemoryStore implements BillingStore`, add the three stub methods there and run the authoring package tests.

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/types.ts packages/core/src/store/mongo.ts packages/core/tests/store-mongo.test.ts packages/core/tests/job-runner.test.ts apps/api/tests/api.test.ts packages/authoring/tests/agent.test.ts
git commit -m "feat: persist encrypted job secrets in Mongo"
```

---

### Task 4: Migrate legacy `credentialsEnv`

**Files:**
- Create: `packages/core/src/migrate-job-secrets.ts`
- Create: `packages/core/tests/migrate-job-secrets.test.ts`
- Modify: `packages/core/src/config.ts` — `credentials` object optional in seed JSON; still parsed into `credentialsEnv` when present
- Modify: `packages/core/tests/config.test.ts` — keep the env-name parse test; add a seed job with no `credentials` key
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `parseMasterKey`, `encryptSecret`, `listJobs`, `listSecrets`, `upsertSecret`, `unsetJobCredentialsEnv`
- Produces:

```ts
export async function migrateJobSecrets(input: {
  store: BillingStore;
  env: NodeJS.ProcessEnv;
}): Promise<void>;
```

For each job with a non-empty `credentialsEnv`:
1. For each `[field, envName]`, if `env[envName]` is non-empty **and** no secret row exists for `(jobId, field)`, encrypt and `upsertSecret` (new `id` via `randomUUID()`, `userId` from the job)
2. Always `unsetJobCredentialsEnv(job.id)` after processing that job (even if some env vars were missing)
3. If `SECRETS_MASTER_KEY` is missing and at least one value needs inserting, `parseMasterKey` throws `ConfigError` (do not boot-require the key when every job is already migrated)
4. Idempotent: second call is a no-op

If `credentials` is omitted in seed JSON, `parseJob` sets no `credentialsEnv` (or `undefined`). If present, keep today’s `usernameEnv` → `credentialsEnv.username` parsing.

- [ ] **Step 1: Write the failing test**

Use an in-memory store (copy the Task 3 Map pattern, or the mongo memory collections store). Env `{ TNPDCL_USERNAME: 'u1', TNPDCL_PASSWORD: 'p1', SECRETS_MASTER_KEY: '11'.repeat(32) }`.

Assert after migrate: `listSecrets` has username/password decryptable to `u1`/`p1`; `getJob` has no `credentialsEnv`. Second migrate does not change ciphertext (or at least does not duplicate rows). Missing env var: job with `credentialsEnv: { username: 'MISSING' }` → no username row, field unset, no throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @billing-agent/core -- packages/core/tests/migrate-job-secrets.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement migrate + optional seed credentials**

- [ ] **Step 4: Run tests**

Run: `npm test -w @billing-agent/core -- packages/core/tests/migrate-job-secrets.test.ts packages/core/tests/config.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/migrate-job-secrets.ts packages/core/tests/migrate-job-secrets.test.ts packages/core/src/config.ts packages/core/tests/config.test.ts packages/core/src/index.ts
git commit -m "feat: migrate credentialsEnv values into encrypted secrets"
```

---

### Task 5: Job runner decrypts secrets

**Files:**
- Modify: `packages/core/src/config.ts` — add `resolveJobSecrets`; delete `resolveJobCredentials` and rewrite `config.test.ts`
- Modify: `packages/core/src/job-runner.ts`
- Modify: `packages/core/tests/job-runner.test.ts`
- Modify: `packages/core/tests/config.test.ts`

**Interfaces:**
- Consumes: `listSecrets`, `decryptSecret`, `parseMasterKey`, `requiredCredentialKeys`
- Produces:

```ts
export async function resolveJobSecrets(
  job: JobDocument,
  store: BillingStore | undefined,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>>;
```

Rules:
- Required keys from `requiredCredentialKeys(job.provider)`
- Missing store while required keys non-empty → `ConfigError('Missing secrets store')`
- Decrypt each listed secret; missing required key → `ConfigError(\`Missing secret "${key}" for job ${job.id}\`)`
- Dummy / unknown provider with zero required keys → `{}` without reading the master key
- `runJob` calls this **before** `withBrowser` and passes the map as `credentials`

- [ ] **Step 1: Write failing tests**

Replace `resolveJobCredentials` tests with `resolveJobSecrets` tests using a tiny in-memory store + encrypted rows.

In `job-runner.test.ts`, add a test that a fake adapter receives `{ username: 'u', password: 'p' }` for `provider: 'tnpdcl'` when those secrets are stored. Existing fake-provider tests should still pass with `store.listSecrets = async () => []` (no required keys).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/core -- packages/core/tests/config.test.ts packages/core/tests/job-runner.test.ts`

Expected: FAIL (`resolveJobSecrets` missing / still using env)

- [ ] **Step 3: Implement**

```ts
const credentials = await resolveJobSecrets(job, runnerDeps.store, runnerDeps.env);
```

Do not write `credentials` onto `RunDocument`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @billing-agent/core -- packages/core/tests/config.test.ts packages/core/tests/job-runner.test.ts packages/core/tests/dummy-adapter.test.ts`

Expected: PASS (dummy still needs no secrets)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/job-runner.ts packages/core/tests/config.test.ts packages/core/tests/job-runner.test.ts
git commit -m "feat: resolve adapter credentials from decrypted secrets"
```

---

### Task 6: API — providers, create secrets, GET/PUT secrets

**Files:**
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/tests/api.test.ts`

**Interfaces:**
- Consumes: `listAdapterProviders`, `validateSecretPayload`, `parseMasterKey`, `encryptSecret`, store secret methods
- Produces HTTP:

| Method | Path | Status / body |
| --- | --- | --- |
| `GET` | `/providers` | 200 `{ providers: listAdapterProviders() }` (JWT) |
| `POST` | `/jobs` | body may include write-only `secrets`. 400 on validate failure. Encrypt then persist. Response `201` job **without** `secrets` or `credentialsEnv` |
| `PATCH` | `/jobs/:id` | 400 if `provider` present and ≠ stored; 400 if `secrets` or `credentialsEnv` present. Persist enabled/schedule/notify only. Strip `credentialsEnv` on response |
| `GET` | `/jobs/:id/secrets` | `{ keys: [{ key, set: true }] }` — 404 other user. Register **before** `GET /jobs/:id` |
| `PUT` | `/jobs/:id/secrets` | `{ values }`. 400 empty/unknown. 409 if `listRuns({ jobId, limit: 20 })` has `status === 'running'`. 404 other user |

Helper:

```ts
function publicJob(job: JobDocument): Omit<JobDocument, 'credentialsEnv'> {
  const { credentialsEnv: _ignored, ...rest } = job;
  return rest;
}
```

Use `publicJob` on GET list, GET one, POST, PATCH, DELETE.

Encrypt helper for routes: `randomUUID()` for new secret ids; on upsert, if `listSecrets` already has the key, reuse `id`/`createdAt`.

Create `tnpdcl` without both secrets → 400. Create `dummy` with `{}` / omitted `secrets` → 201.

Set `process.env.SECRETS_MASTER_KEY` in API tests to `'11'.repeat(32)` in `before` / restore in `after`.

- [ ] **Step 1: Write failing API tests**

Add a `describe('job secrets')` in `apps/api/tests/api.test.ts`:

1. `GET /providers` returns tnpdcl + dummy keys
2. `POST /jobs` tnpdcl with secrets → 201 body has no `secrets` / `credentialsEnv`; `GET /jobs/:id/secrets` → both keys `set: true`; `GET /jobs/:id` has no password
3. `POST /jobs` tnpdcl missing password → 400
4. `PUT /jobs/:id/secrets` `{ password: 'x' }` then GET keys still set
5. `PUT` while a run with `status: 'running'` exists → 409
6. Other user’s job secrets → 404
7. `PATCH` with `{ provider: 'dummy' }` on a tnpdcl job → 400
8. `GET /jobs` list items have no `credentialsEnv`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/api -- tests/api.test.ts`

Expected: FAIL (404 Not found on `/providers` / `/secrets`)

- [ ] **Step 3: Implement routes**

Match `/jobs/:id/secrets` the same way `/jobs/:id/run` does (reject extra slashes). Catch `ConfigError` from `parseMasterKey` and `sendJson(res, 500, { error: 'Internal server error' })` — do not put the key in the body (existing server catch is OK if the message is only the env var **name**).

- [ ] **Step 4: Run API tests**

Run: `npm test -w @billing-agent/api`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes.ts apps/api/tests/api.test.ts
git commit -m "feat: add job secret APIs and provider schema endpoint"
```

---

### Task 7: Job form labelled secrets

**Files:**
- Modify: `apps/web/src/lib/types.ts` — drop `credentialsEnv` from `JobDocument`
- Modify: `apps/web/src/lib/jobs-api.ts` — `listProviders`, `getJobSecrets`, `updateJobSecrets`; `createJob` sends optional `secrets`
- Modify: `apps/web/src/lib/jobs-api.test.ts`
- Modify: `apps/web/src/pages/job-form-page.tsx`
- Modify: `apps/web/src/pages/job-form-page.test.tsx`
- Modify: `apps/web/src/pages/jobs-page.test.tsx` — drop `credentialsEnv` from fixtures
- Delete: `apps/web/src/components/credentials-env-editor.tsx`

**Interfaces:**
- Consumes: `/providers`, `POST /jobs`, `PATCH /jobs/:id`, `GET|PUT /jobs/:id/secrets`
- Produces UI:
  - Provider select disabled on edit
  - One labelled input per `credentialKeys` (`type="password"` iff key is `password`)
  - Create: all keys required
  - Edit: show “set” (helper text or input placeholder `Leave blank to keep`) when `GET secrets` has that key; Save → `PATCH` job fields; if any secret input non-empty → `PUT /jobs/:id/secrets` with those keys only

```ts
export async function listProviders(): Promise<{
  providers: Array<{ id: string; credentialKeys: string[] }>;
}>;
export async function getJobSecrets(
  id: string,
): Promise<{ keys: Array<{ key: string; set: true }> }>;
export async function updateJobSecrets(
  id: string,
  values: Record<string, string>,
): Promise<void>;
```

`createJob` body type: `JobDocument & { secrets?: Record<string, string> }`.

- [ ] **Step 1: Write failing form tests**

Mock `listProviders` → tnpdcl keys. Create flow: fill job id, notify title, username, password; Save calls `createJob` with `secrets: { username, password }` and **no** `credentialsEnv`. No “Add credential” button.

Edit flow: `getJobSecrets` returns username+password set; leave password blank, type new username; Save calls `updateJob` without secrets and `updateJobSecrets` with `{ username: 'new' }` only.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/web -- src/pages/job-form-page.test.tsx`

Expected: FAIL

- [ ] **Step 3: Implement form + API helpers; delete `credentials-env-editor.tsx`**

Load fields from `GET /providers`. If that request fails, show the page error Alert (same as job load failure). Do not hardcode a second provider list.

- [ ] **Step 4: Run web tests**

Run: `npm test -w @billing-agent/web`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: collect per-job tnpdcl secrets in the job form"
```

---

### Task 8: Boot migrate, seed, docs

**Files:**
- Modify: `apps/worker/src/cli.ts` — after every `connectStore`, `await migrateJobSecrets({ store, env: process.env })` before runs/daemon/seed (seed: upsert jobs first, then migrate)
- Modify: `README.md` — document `SECRETS_MASTER_KEY` (`openssl rand -hex 32`); `TNPDCL_USERNAME` / `TNPDCL_PASSWORD` only until first successful migrate
- Modify: `docs/superpowers/specs/2026-09-14-adapter-job-secrets-design.md` — set **Plan:** to this file
- Modify: `postman/billing-agent-api.postman-collection.json` — drop `credentialsEnv` from the example POST body; add `GET /providers`, `GET /jobs/:id/secrets`, `PUT /jobs/:id/secrets`
- `jobs.example.json` / `jobs.coolify.json` may keep `credentials` for migrate; no change required

**Interfaces:**
- Consumes: `migrateJobSecrets`
- Produces: daemon/API boot migrates leftover `credentialsEnv` without a separate CLI command

- [ ] **Step 1: Wire `cli.ts`** (Task 4 already tests migrate; do not add a live-Mongo test)

`seed-jobs`: upsert settings + jobs, then `migrateJobSecrets`. `daemon` / `run` / `run --job`: migrate immediately after connect.

- [ ] **Step 2: README + Postman** (spec Plan line already points at this file)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS (workspace root script). No live TNPDCL.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/cli.ts README.md docs/superpowers/specs/2026-09-14-adapter-job-secrets-design.md postman/billing-agent-api.postman-collection.json
git commit -m "feat: migrate adapter secrets on worker boot"
```

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| Provider schema / `GET /providers` | 1, 6, 7 |
| AES-256-GCM / `SECRETS_MASTER_KEY` | 2 |
| Mongo `secrets` / 1:1 job keys | 3 |
| Drop `credentialsEnv` from API JSON | 6, 7 |
| `POST /jobs` write-only secrets | 6, 7 |
| `PATCH` cannot change provider / secrets | 6 |
| `GET`/`PUT /jobs/:id/secrets` + 409 running | 6 |
| Create requires tnpdcl keys; edit omit = keep | 6, 7 |
| Runner decrypts before adapter | 5 |
| Boot + seed migrate | 4, 8 |
| Dummy zero secrets | 1, 5, 6 |
| No live TNPDCL CI | all tests |
| Adapter unchanged / no profiles / no group-pay | out of scope (no tasks) |
