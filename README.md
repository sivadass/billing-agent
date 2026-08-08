# billing-agent

Personal billing checker: scheduled browser automation for electricity, internet, and similar bills, with [ntfy.sh](https://ntfy.sh) notifications.

Each job launches headless Chromium, runs a provider-specific adapter (login, captcha if needed, scrape), sends a success or failure notification, and exits. Designed for cron or a built-in daemon.

## What it does

1. Load `jobs.json` and resolve secrets from environment variables
2. Launch a short-lived Chromium instance (Playwright)
3. Run the adapter for the job’s `provider` (`dummy`, `tnpdcl`, or your own)
4. POST bill details (amount, due date, period, masked account) to ntfy on success

When TNPDCL Bill Payments and Disconnected Services both show "No records found", the job succeeds without sending a success notification.

5. On failure: classify the error, optionally save a screenshot under `tmp/`, notify with high priority

Built-in adapters:

| Provider | Job id (example) | Notes |
| --- | --- | --- |
| `dummy` | `smoke-test` | Local HTML fixture; no login or Mistral required |
| `tnpdcl` | `home-eb` | TNPDCL/TANGEDCO portal; Mistral captcha OCR |

## RAM note

The browser is tuned for modest VPS hosts (≥1 GB RAM): headless Chromium, disabled GPU/extensions, `--disable-dev-shm-usage`, and a reduced V8 heap flag. Each run is **short-lived** (launch → one job → close).

This is **not** a guarantee of ≤256 MB peak RSS while Chromium is running—that figure is aspirational only. Plan for brief spikes during page load; avoid overlapping runs on very small machines.

## Setup

**Requirements:** Node.js 20+, npm

```bash
git clone <repo-url> billing-agent
cd billing-agent
npm install
```

`npm install` runs `playwright install chromium` via `postinstall`. If you skipped postinstall (e.g. `npm install --ignore-scripts`), install Chromium manually:

```bash
npx playwright install chromium
```

Copy the example config and secrets (neither file is committed):

```bash
cp jobs.example.json jobs.json
cp .env.example .env
```

Edit `.env`:

| Variable | Required for | Purpose |
| --- | --- | --- |
| `NTFY_TOPIC` | All jobs | ntfy topic (keep secret) |
| `MISTRAL_API_KEY` | `tnpdcl` | Captcha OCR via Mistral vision |
| `TNPDCL_USERNAME` | `home-eb` | Portal login |
| `TNPDCL_PASSWORD` | `home-eb` | Portal login |

Adjust `jobs.json` (ids, schedules, enabled flags, notify titles). Credential fields in JSON reference env var **names**, not plaintext passwords.

Build:

```bash
npm run build
```

## Commands

```bash
# Run one job by id
node dist/cli.js run --job smoke-test

# Run every enabled job
node dist/cli.js run --all

# Built-in scheduler (cron expressions from jobs.json)
node dist/cli.js daemon

# Custom config path
node dist/cli.js run --job home-eb --config /path/to/jobs.json
```

Exit codes: `0` success, `1` one or more jobs failed, `2` usage error (missing `--job` / `--all`).

Development without building:

```bash
npm run dev -- run --job smoke-test
```

## Cron example

Prefer one-shot runs so each invocation gets a fresh browser process:

```cron
0 9 * * * cd /path/to/billing-agent && node dist/cli.js run --job home-eb
```

Run all enabled jobs on a schedule:

```cron
0 9 * * * cd /path/to/billing-agent && node dist/cli.js run --all
```

Ensure `.env` is loaded (cron does not read it automatically). Options: `cd` into the project and rely on dotenv in the CLI, wrap with a small shell script that `source`s env vars, or set variables in the crontab line.

Alternative: `node dist/cli.js daemon` keeps the process alive and schedules jobs from each job’s `schedule` field in `jobs.json`.

## Smoke test (dummy + ntfy)

Verifies the full pipeline except a real provider login:

```bash
cp jobs.example.json jobs.json   # if you have not already
# set NTFY_TOPIC in .env (Mistral not required for dummy)
npm run build
node dist/cli.js run --job smoke-test
```

Expected: exit code `0`; ntfy message titled **Dummy Bill** with body containing `Amount: ₹999.00`.

## Adding adapters

1. Create `src/adapters/<provider>.ts` implementing `BillingAdapter`:

   ```typescript
   import type { BillingAdapter } from './types.js';

   export const myAdapter: BillingAdapter = {
     id: 'my-provider',
     async run(ctx) {
       // ctx.page, ctx.credentials, ctx.captchaSolver, ctx.logger, …
       return {
         provider: 'my-provider',
         amount: '₹123.00',
         accountLabel: '****1234',
       };
     },
   };
   ```

2. Register it in `src/adapters/registry.ts`:

   ```typescript
   import { myAdapter } from './my-provider.js';

   export function registerBuiltInAdapters(): void {
     registerAdapter(dummyAdapter);
     registerAdapter(tnpdclAdapter);
     registerAdapter(myAdapter);
   }
   ```

3. Add a job entry in `jobs.json` with `"provider": "my-provider"` and credential env refs as needed.

4. Rebuild and run: `npm run build && node dist/cli.js run --job <your-job-id>`.

See `src/adapters/dummy.ts` for a minimal example and `src/adapters/tnpdcl.ts` for captcha + login flow.

## Security

- **`jobs.json` and `.env` are gitignored** — never commit real topics, passwords, or API keys.
- Use a private, unguessable `NTFY_TOPIC`; treat it like a password.
- Error screenshots under `tmp/` may contain portal UI or account hints; restrict filesystem permissions.
- Run on a trusted host; credentials exist only in process env at runtime.

## Tests

```bash
npm test
```

Unit tests cover config, captcha, notify (mocked HTTP), job runner, dummy adapter (fixture + real Chromium), and TNPDCL helpers. Live TNPDCL login is **not** run in CI—verify `home-eb` manually with real credentials.

## Further reading

Architecture and config schema: `docs/superpowers/specs/2026-08-08-billing-agent-design.md`
