# Billing Agent Design

**Date:** 2026-08-08  
**Status:** Approved for implementation planning  
**Stack:** Node.js, TypeScript, Playwright (Chromium), Mistral vision, ntfy.sh

## Problem

Personal recurring bills (electricity, internet, etc.) require logging into provider portals to check amounts. This tool automates that check on a schedule and pushes results (or failures) to ntfy.sh.

## Goals

- Lightweight, cron-friendly Node.js CLI: launch browser → login → scrape bill → notify → exit
- Named provider adapters (not a generic selector DSL in JSON)
- Optional built-in scheduler plus one-shot CLI for OS cron
- Headless Chromium tuned for modest VPS RAM (≥1GB); short-lived processes preferred
- Captcha solving via `mistral-small-latest` vision API
- Secrets never stored in plaintext in the jobs file

## Non-goals (v1)

- Bill payment
- Parallel multi-browser jobs
- Human-in-the-loop captcha UI
- BBPS / third-party bill-fetch APIs
- Guaranteeing peak RSS ≤256MB while Chromium is running (aspirational only)
- Live TNPDCL tests in CI

## Constraints & decisions

| Topic | Decision |
| --- | --- |
| Runtime host | Normal machine/VPS (≥1GB); keep runs light |
| Job model | Named adapters; JSON supplies ids, schedules, env refs, ntfy overrides |
| Scheduling | Hybrid: one-shot CLI for cron + optional `--daemon` with cron expressions in JSON |
| v1 providers | Framework + `dummy` + `tnpdcl` (TNPDCL/TANGEDCO) |
| Captcha | Mistral vision (`mistral-small-latest`) with one retry |
| Secrets | Hybrid: non-secrets in JSON; passwords, API keys, ntfy topic via env |
| Notify payload | Amount, due date, bill period, status, masked account label |
| Browser | Playwright + Chromium only |

## Architecture

```text
cron / systemd timer          OR          billing-agent daemon
        │                                      │
        ▼                                      ▼
   billing-agent run ──► job-runner ──► adapter registry
                              │              │
                              │         dummy | tnpdcl
                              ▼
                    browser → captcha(mistral) → notify(ntfy)
```

### Modules

| Module | Responsibility |
| --- | --- |
| `cli` | Parse args; `run` vs `daemon` modes |
| `config` | Load/validate `jobs.json` + resolve env refs |
| `job-runner` | Orchestrate one or many jobs; exit code aggregation |
| `browser` | Playwright launch/teardown + low-RAM flags |
| `captcha` | Element screenshot → Mistral → captcha text |
| `notify` | POST to ntfy.sh (success / failure) |
| `scheduler` | `node-cron` (or equivalent) for daemon mode only |
| `adapters/*` | Provider-specific login + scrape |

### Per-job lifecycle

1. Resolve config and credentials from env
2. Launch headless Chromium (one browser, one context, one page)
3. Run adapter
4. Format and send ntfy success message
5. Close browser in `finally`
6. On failure: classify error, optional screenshot, ntfy failure, continue or stop per CLI policy (`--all` continues other jobs)

## Config

Committed example: `jobs.example.json`. Real `jobs.json` and `.env` are gitignored.

```json
{
  "ntfy": {
    "baseUrl": "https://ntfy.sh",
    "topicEnv": "NTFY_TOPIC",
    "priority": "default"
  },
  "mistral": {
    "apiKeyEnv": "MISTRAL_API_KEY",
    "model": "mistral-small-latest"
  },
  "browser": {
    "headless": true,
    "timeoutMs": 60000,
    "saveErrorScreenshot": true
  },
  "jobs": [
    {
      "id": "home-eb",
      "provider": "tnpdcl",
      "enabled": true,
      "schedule": "0 9 * * *",
      "credentials": {
        "usernameEnv": "TNPDCL_USERNAME",
        "passwordEnv": "TNPDCL_PASSWORD"
      },
      "notify": { "title": "TNPDCL Bill" }
    },
    {
      "id": "smoke-test",
      "provider": "dummy",
      "enabled": true,
      "schedule": null,
      "credentials": {},
      "notify": { "title": "Dummy Bill" }
    }
  ]
}
```

### Rules

- Secrets only via env names referenced in JSON
- `schedule`: used by daemon mode; ignored for one-shot CLI (OS cron decides timing)
- `provider` must match a registered adapter
- Global `ntfy` / `mistral` / `browser` with optional per-job `notify` overrides

### CLI

```text
billing-agent run --job <id>
billing-agent run --all
billing-agent daemon
```

Exit non-zero if any selected job failed.

## Adapter contract

```ts
type BillResult = {
  provider: string;
  amount: string;
  dueDate?: string;
  billPeriod?: string;
  status?: string;
  accountLabel: string;
  rawNotes?: string;
};

interface BillingAdapter {
  id: string;
  run(ctx: AdapterContext): Promise<BillResult>;
}
```

`AdapterContext` provides: Playwright `page`, resolved credentials, captcha helper, timeouts, logger.

### `dummy`

Opens a local HTML fixture (preferred) or a trivial page, returns a fixed sample `BillResult`. Validates CLI → browser → notify without external portals or Mistral.

### `tnpdcl`

1. Navigate to TNPDCL login at `https://www.tnebnet.org/awp/login` (adjust only inside the adapter if the portal redirects)
2. Fill username/password from env
3. Capture captcha image → Mistral OCR → fill + submit
4. On captcha/login failure: one retry with fresh captcha
5. Navigate to bill/details view
6. Scrape amount, due date, bill period, status; mask consumer/service id for `accountLabel`
7. Return `BillResult`

All selectors and portal quirks live only inside this adapter. If the live DOM differs from assumptions, fix selectors in `tnpdcl.ts` only — do not change the shared runner.

### Captcha helper

- Screenshot captcha element → base64 data URL
- Call Mistral chat completions with vision content and a strict prompt: return captcha characters only
- Trim/normalize response; reject empty/overlong answers as `CaptchaError`
- Never log API keys or captcha image payloads

## Browser & memory

- Install Playwright **chromium** only
- No parallel browsers in v1
- One-shot mode preferred for cron (process exits; no idle RAM)
- Daemon mode does **not** keep a warm browser; launch per tick, then close
- Baseline flags: `--disable-dev-shm-usage`, `--disable-gpu`, `--disable-extensions`, configurable `--no-sandbox` for containers, small viewport (e.g. 1280×720), `--js-flags=--max-old-space-size=128` (tune if needed)
- Optional resource blocking (images/fonts) behind a flag; default off for TNPDCL if it breaks layout/selectors
- Hard per-job timeout; always tear down page/context/browser in `finally`

**Honest RAM note:** peak RSS while Chromium runs typically exceeds 256MB. The design optimizes for short-lived runs on ≥1GB hosts, not Chromium-in-256MB.

## Errors & notifications

### Success (ntfy priority: default)

- Title: per-job `notify.title`
- Body: amount, due date, bill period, status, masked account label

### Failure (ntfy priority: high)

- Title: `Billing agent failed: {jobId}`
- Body: error class + short message
- If `saveErrorScreenshot`: capture last page screenshot under project `tmp/` (gitignored); include path in the ntfy body. File attachment via ntfy is optional best-effort, not required for v1 success.

### Error classes

`ConfigError` | `CaptchaError` | `LoginError` | `ScrapeError` | `NotifyError` | `TimeoutError`

### Retries

- Captcha/login: 1 automatic retry
- ntfy POST: 1 retry on 5xx/network
- Then fail and notify

### Logging

Structured console logs (job id, step, duration). Never log passwords, API keys, or captcha images.

## Project layout

```text
src/
  cli.ts
  config.ts
  job-runner.ts
  browser.ts
  captcha.ts
  notify.ts
  scheduler.ts
  adapters/
    types.ts
    registry.ts
    dummy.ts
    tnpdcl.ts
jobs.example.json
.env.example
package.json
tsconfig.json
README.md
docs/superpowers/specs/2026-08-08-billing-agent-design.md
```

Filenames use kebab-case per project rules. Exported TypeScript symbols may use PascalCase/camelCase as usual.

## Testing

- Unit: config validation, env resolution, `BillResult` → ntfy body formatting
- Smoke: `dummy` end-to-end against local HTML fixture (no live TNPDCL/Mistral required for CI)
- `tnpdcl`: manual verification with real credentials; not required in CI

## Success criteria

1. `billing-agent run --job smoke-test` launches headless Chromium, sends ntfy, exits 0
2. TNPDCL job works with real env credentials when captcha OCR succeeds
3. Failures produce high-priority ntfy messages and non-zero exit
4. OS cron can invoke one-shot runs without a resident Node process
5. Daemon mode runs enabled jobs according to JSON `schedule` values

## Implementation notes

- ESM + TypeScript compiled with `tsc` to `dist/`; run via `node dist/cli.js` (npm scripts wrap build + run). Dev may use `tsx` for convenience, but the supported production path is compiled `dist/`.
- Dependencies: `playwright`, `@mistralai/mistralai`, `dotenv`, `commander`, and `node-cron` (daemon mode only).
- Document required env vars in `.env.example` and README.
- Respect provider site terms; this tool is for personal bill visibility automation.
