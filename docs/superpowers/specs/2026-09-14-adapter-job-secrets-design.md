# Adapter Job Secrets Design

**Date:** 2026-09-14  
**Status:** Approved for implementation planning  
**Related:** `2026-08-08-billing-agent-design.md`, `2026-08-09-jobs-runs-ui-design.md`, `2026-08-16-generic-site-jobs-design.md`

## Problem

The `tnpdcl` adapter is already shared, but a job still carries `credentialsEnv` (field name → host env var name). A second TNPDCL login means duplicating the job **and** adding `TNPDCL_USERNAME_2` / `TNPDCL_PASSWORD_2` in Coolify. The job form is a free-form key/value editor, so the provider does not even declare that it needs `username` and `password`.

Operators want N independent TNPDCL logins (home, office, parents, rentals): each with its own schedule, notify title, enable flag, and run history — without mapping env names or sharing a credential vault.

## Goals

- One job = one login; same provider (`tnpdcl`) can have many jobs
- Provider declares required secret keys; the form shows labelled write-only fields
- Store username/password encrypted in Mongo; host env keeps only `SECRETS_MASTER_KEY`
- Existing Coolify job keeps working after a one-time migrate from `credentialsEnv`
- Dummy jobs still run with zero secrets
- Adapter `run({ credentials })` stays unchanged

## Non-goals

- Reusable login profiles / an Accounts collection
- Scraping multiple consumer numbers under one TNPDCL login (group-pay)
- Chat authoring, workflow engine, or dropping the TypeScript adapter
- Showing plaintext passwords in GET responses or the UI
- Master-key rotation ceremony
- Changing captcha, overlay recovery, or empty-bills notify behavior

## Decisions

| Topic | Decision |
| --- | --- |
| Identity | One job per login; credentials are 1:1 with the job |
| Secret storage | AES-256-GCM in Mongo `secrets`; one wrapping key `SECRETS_MASTER_KEY` |
| Job JSON | Drop `credentialsEnv` from the API/document shape after migrate |
| Provider schema | In code: `tnpdcl` → `username`, `password`; `dummy` → none |
| Create | `POST /jobs` accepts write-only `secrets`; `tnpdcl` requires both keys |
| Edit job | `PUT /jobs/:id` may not change `provider`; secrets via `PUT /jobs/:id/secrets` |
| Empty string | Rejected (400); omitting a key on edit leaves existing ciphertext |
| Run in progress | `PUT` secrets → 409 |
| Cross-user | 404, same as jobs |
| Lost master key | Decrypt fails; user re-enters secrets per job |
| This vs generic-site-jobs | Precursor slice of that spec’s secrets model, applied to the **current** adapter job form — not chat, not workflows |

## Provider schema

```ts
export const adapterCredentialKeys: Record<string, readonly string[]> = {
  tnpdcl: ['username', 'password'],
  dummy: [],
};
```

`GET /providers` returns built-in adapters with those keys so the SPA does not hardcode the field list:

```json
{ "providers": [{ "id": "tnpdcl", "credentialKeys": ["username", "password"] }, { "id": "dummy", "credentialKeys": [] }] }
```

Unknown `job.provider` is still a config/run error (`Unknown provider`), unchanged.

## Secrets

Same crypto and document shape as `2026-08-16-generic-site-jobs-design.md`:

```ts
type SecretDocument = {
  id: string;
  userId: string;
  jobId: string;
  key: string;
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes
  tag: string; // base64 GCM tag
  createdAt: string;
  updatedAt: string;
};
```

This slice does **not** use `conversationId` (no chat authoring). `jobId` is always set.

`SECRETS_MASTER_KEY`: 32-byte key, 64-char hex or 44-char base64. Missing/invalid → `ConfigError` at encrypt/decrypt time, not at process boot.

Helpers in `packages/core/src/secrets.ts`: `parseMasterKey`, `encryptSecret`, `decryptSecret`. Never log plaintext or key material.

One row per `(jobId, key)`. Same key on the same job is upserted.

## Job document

Remove `credentialsEnv` from `JobDocument` after migrate:

```ts
type JobDocument = {
  id: string;
  userId: string;
  provider: string;
  enabled: boolean;
  schedule: string | null;
  notify: { title: string };
};
```

Seed JSON (`jobs.json` / `jobs.coolify.json`) no longer requires a `credentials` block. Optional legacy `credentials.usernameEnv` is accepted **only** by migrate so existing files still import.

## API

All routes stay JWT-scoped to `userId`.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/providers` | Built-in adapters + `credentialKeys` |
| `POST` | `/jobs` | Job fields + optional write-only `secrets`. Encrypts immediately. Response is the job **without** secrets. `tnpdcl` requires both schema keys. Unknown keys → 400. |
| `PUT` | `/jobs/:id` | `enabled`, `schedule`, `notify` only. `provider` mismatch → 400. Must not accept `secrets` or `credentialsEnv`. |
| `GET` | `/jobs/:id/secrets` | `{ keys: [{ key, set: true }] }` — no values, no ciphertext |
| `PUT` | `/jobs/:id/secrets` | `{ values: Record<string, string> }`. Encrypt upsert by `(jobId, key)`. Omit = keep. Empty string → 400. Unknown key → 400. Run `running` → 409. |

`GET /jobs` and `GET /jobs/:id` never include `secrets`, ciphertext, or `credentialsEnv`.

## UI

Job form:

- Provider select as today (`tnpdcl` / `dummy`)
- For each `credentialKeys` entry: labelled input, `type="password"` for `password`, text for `username`
- **Create:** all schema keys required
- **Edit Save:** `PUT /jobs/:id` with non-secret fields. If any secret input is non-empty, also `PUT /jobs/:id/secrets` with those keys only. Empty secret inputs are omitted (ciphertext kept).
- Remove `CredentialsEnvEditor`

Provider is editable only on create (disabled on edit), matching the API.

A second TNPDCL account is another job: different id, notify title, schedule, and secrets.

## Runner

Replace `resolveJobCredentials(job, env)` with `resolveJobSecrets(job, store, env)`:

1. Load secret rows for `job.id`
2. Decrypt with `SECRETS_MASTER_KEY`
3. Require every key in `adapterCredentialKeys[job.provider]`
4. Pass the map as `credentials` into `adapter.run` (unchanged)

Missing required secret at run time → `ConfigError` before browser login; existing failure ntfy path.

Plaintext lives in process memory for the run only. Not written to `RunDocument`, logs, or screenshots metadata.

## Migrate

Idempotent helper, run on worker/API boot (and when seeding from JSON) if any job still has `credentialsEnv`:

1. For each job that still has `credentialsEnv` (legacy Mongo or seed)
2. For each field → env name, read `process.env[envName]`
3. If the value is non-empty and no secret row exists for that `(jobId, key)`, encrypt and insert
4. Unset `credentialsEnv` on the job document

After a successful migrated run, `TNPDCL_USERNAME` / `TNPDCL_PASSWORD` are unused. Operators may delete them from host env.

If an env var is missing during migrate, skip that key and leave the job without it; the next run fails with `ConfigError` until the user fills the form.

## Errors

| Case | Result |
| --- | --- |
| Create `tnpdcl` missing username or password | 400 |
| Empty secret string | 400 |
| Secret key not in provider schema | 400 |
| `PUT` secrets while run `running` | 409 |
| Other user’s job | 404 |
| Missing/invalid `SECRETS_MASTER_KEY` on encrypt/decrypt | 500 generic; no key material in body |
| Missing secret at run | Failed run, `ConfigError`, failure ntfy |
| Wrong master key | Decrypt fails; user re-enters per job |
| Adapter login/captcha/scrape | Unchanged (`CaptchaError` retry, empty bills `notify: false`) |

## Testing

No live TNPDCL and no live Mistral.

- Encrypt/decrypt round-trip; wrong key throws
- Migrate copies env values named in legacy `credentialsEnv` into secret rows and clears `credentialsEnv`
- `POST /jobs` with secrets: response has neither `secrets` nor `credentialsEnv`; `GET /jobs/:id/secrets` returns keys only
- `PUT /jobs/:id/secrets` 409 when a run is `running`
- Job runner decrypts and passes `{ username, password }` to a fake adapter
- Dummy still succeeds with zero secrets
- Job form: labelled fields; create requires both; edit can omit when set; no credentialsEnv editor

## Success criteria

1. Operator can create a second `tnpdcl` job from the UI by filling username, password, schedule, and notify title — no new Coolify env vars.
2. Each job has independent run history and notify title.
3. The existing migrated job still logs in using decrypted secrets, not `TNPDCL_PASSWORD`.
4. `GET` job payloads never contain secret values.
5. Dummy smoke job still runs in CI.
