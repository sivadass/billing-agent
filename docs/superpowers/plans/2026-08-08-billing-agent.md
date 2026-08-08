# Billing Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cron-friendly Node.js + TypeScript CLI that runs named billing adapters (dummy + TNPDCL) via headless Playwright, solves captchas with Mistral vision, and notifies ntfy.sh.

**Architecture:** Short-lived CLI loads `jobs.json`, resolves secrets from env, launches one Chromium instance per job, runs a provider adapter, posts success/failure to ntfy, then exits. Optional daemon mode uses `node-cron` and still launches a fresh browser per tick.

**Tech Stack:** Node.js 20+, TypeScript (ESM, `tsc` → `dist/`), Playwright Chromium, `@mistralai/mistralai`, `commander`, `dotenv`, `node-cron`, Node.js built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-08-billing-agent-design.md`

## Global Constraints

- Filenames: kebab-case only (workspace rule)
- Secrets: never plaintext in JSON; env refs only
- Browser: Playwright chromium only; one browser/context/page per job; always close in `finally`
- Captcha: `mistral-small-latest` vision; one retry on captcha/login failure
- Notify: success body = amount, due date, bill period, status, masked account; failures = high priority
- Production run path: `node dist/cli.js` after `tsc`
- No live TNPDCL tests in CI; dummy fixture covers smoke
- Peak RSS ≤256MB is aspirational only — do not add hacks that break the portal

## File Structure

| Path | Responsibility |
| --- | --- |
| `package.json` | Scripts, deps, `"type": "module"`, bin |
| `tsconfig.json` | ESM TypeScript compile to `dist/` |
| `jobs.example.json` | Example config (committed) |
| `.env.example` | Env var template (committed) |
| `src/errors.ts` | Typed error classes |
| `src/logger.ts` | Structured console logger |
| `src/config.ts` | Load/validate jobs + resolve env |
| `src/notify.ts` | Format + POST ntfy |
| `src/captcha.ts` | Screenshot → Mistral → text |
| `src/browser.ts` | Launch/teardown Playwright |
| `src/job-runner.ts` | Orchestrate job lifecycle |
| `src/scheduler.ts` | Daemon cron wiring |
| `src/cli.ts` | Commander entrypoint |
| `src/adapters/types.ts` | `BillResult`, `BillingAdapter`, context |
| `src/adapters/registry.ts` | provider id → adapter |
| `src/adapters/dummy.ts` | Fixture-based smoke adapter |
| `src/adapters/tnpdcl.ts` | TNPDCL login + scrape |
| `fixtures/dummy-bill.html` | Local bill page for dummy |
| `tests/*.test.ts` | Unit/smoke tests |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jobs.example.json`
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `README.md` (minimal stub pointing to later docs — expand in Task 12)

**Interfaces:**
- Consumes: none
- Produces: buildable empty TS project; npm scripts `build`, `test`, `start`

- [ ] **Step 1: Update `.gitignore`**

Append (and keep existing rules):

```gitignore
# Billing agent local secrets / runtime
jobs.json
tmp/
!.env.example
```

Note: `.env.*` already ignores `.env.local` etc.; `!.env.example` un-ignores the template.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "billing-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "billing-agent": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/cli.js",
    "dev": "tsx src/cli.ts",
    "test": "tsx --test tests/**/*.test.ts",
    "postinstall": "playwright install chromium"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@mistralai/mistralai": "^1.10.0",
    "commander": "^13.1.0",
    "dotenv": "^16.5.0",
    "node-cron": "^3.0.3",
    "playwright": "^1.52.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "@types/node-cron": "^3.0.11",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0"
  }
}
```

Pin versions to whatever `npm install` resolves at implementation time if needed; keep these packages.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create `jobs.example.json`**

Use the exact JSON from the design spec (`ntfy`, `mistral`, `browser`, jobs `home-eb` + `smoke-test`).

- [ ] **Step 5: Create `.env.example`**

```bash
NTFY_TOPIC=your-secret-topic
MISTRAL_API_KEY=your-mistral-api-key
TNPDCL_USERNAME=
TNPDCL_PASSWORD=
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`  
Expected: `node_modules` created; Chromium installed via postinstall (may take a few minutes).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json jobs.example.json .env.example .gitignore
git commit -m "chore: scaffold billing-agent TypeScript project"
```

---

### Task 2: Errors and logger

**Files:**
- Create: `src/errors.ts`
- Create: `src/logger.ts`
- Create: `tests/errors.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `class AppError extends Error { readonly code: ErrorCode }`
  - `type ErrorCode = 'ConfigError' | 'CaptchaError' | 'LoginError' | 'ScrapeError' | 'NotifyError' | 'TimeoutError'`
  - `ConfigError`, `CaptchaError`, `LoginError`, `ScrapeError`, `NotifyError`, `TimeoutError` subclasses
  - `createLogger(jobId?: string)` → `{ info, warn, error }` logging JSON lines to stdout/stderr

- [ ] **Step 1: Write failing test**

```ts
// tests/errors.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, CaptchaError } from '../src/errors.ts';

describe('errors', () => {
  it('exposes stable error codes', () => {
    const err = new ConfigError('missing topic');
    assert.equal(err.code, 'ConfigError');
    assert.equal(err.name, 'ConfigError');
    assert.match(err.message, /missing topic/);
  });

  it('CaptchaError is distinguishable', () => {
    const err = new CaptchaError('empty ocr');
    assert.equal(err.code, 'CaptchaError');
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `npm test`  
Expected: FAIL — cannot find module `../src/errors.ts`

- [ ] **Step 3: Implement `src/errors.ts` and `src/logger.ts`**

```ts
// src/errors.ts
export type ErrorCode =
  | 'ConfigError'
  | 'CaptchaError'
  | 'LoginError'
  | 'ScrapeError'
  | 'NotifyError'
  | 'TimeoutError';

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = code;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('ConfigError', message, options);
  }
}
export class CaptchaError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('CaptchaError', message, options);
  }
}
export class LoginError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('LoginError', message, options);
  }
}
export class ScrapeError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('ScrapeError', message, options);
  }
}
export class NotifyError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('NotifyError', message, options);
  }
}
export class TimeoutError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('TimeoutError', message, options);
  }
}
```

```ts
// src/logger.ts
type Level = 'info' | 'warn' | 'error';

function log(level: Level, jobId: string | undefined, message: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    jobId: jobId ?? null,
    message,
    ...extra,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function createLogger(jobId?: string) {
  return {
    info: (message: string, extra?: Record<string, unknown>) => log('info', jobId, message, extra),
    warn: (message: string, extra?: Record<string, unknown>) => log('warn', jobId, message, extra),
    error: (message: string, extra?: Record<string, unknown>) => log('error', jobId, message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/logger.ts tests/errors.test.ts
git commit -m "feat: add error types and structured logger"
```

---

### Task 3: Config loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`
- Create: `tests/fixtures/jobs.valid.json` (minimal valid copy for tests)

**Interfaces:**
- Consumes: `ConfigError`
- Produces:
  - `loadConfig(options?: { configPath?: string; env?: NodeJS.ProcessEnv }): AppConfig`
  - Types: `AppConfig`, `JobConfig`, `ResolvedNtfy`, `ResolvedMistral`, `BrowserConfig`
  - Resolves `topicEnv` / `apiKeyEnv` / credential env names into concrete strings
  - Throws `ConfigError` on missing file, invalid shape, unknown provider later deferred to runner, missing env values for selected jobs

```ts
export type BrowserConfig = {
  headless: boolean;
  timeoutMs: number;
  saveErrorScreenshot: boolean;
  noSandbox?: boolean;
};

export type JobConfig = {
  id: string;
  provider: string;
  enabled: boolean;
  schedule: string | null;
  credentials: Record<string, string>; // already resolved env values keyed by logical name (username, password)
  notify: { title: string };
};

export type AppConfig = {
  configPath: string;
  ntfy: { baseUrl: string; topic: string; priority: string };
  mistral: { apiKey: string; model: string };
  browser: BrowserConfig;
  jobs: JobConfig[];
};
```

Credential resolution rule: for each key ending in `Env` under `credentials` (e.g. `usernameEnv`), read that env var into a map key without the `Env` suffix (`username`). Global `topicEnv` / `apiKeyEnv` resolve to `topic` / `apiKey`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/config.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { ConfigError } from '../src/errors.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(dir, 'fixtures', 'jobs.valid.json');

describe('loadConfig', () => {
  it('resolves env refs', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: {
        NTFY_TOPIC: 'bills',
        MISTRAL_API_KEY: 'mk-test',
        TNPDCL_USERNAME: 'user1',
        TNPDCL_PASSWORD: 'pass1',
      },
    });
    assert.equal(cfg.ntfy.topic, 'bills');
    assert.equal(cfg.mistral.apiKey, 'mk-test');
    const job = cfg.jobs.find((j) => j.id === 'home-eb');
    assert.ok(job);
    assert.equal(job.credentials.username, 'user1');
    assert.equal(job.credentials.password, 'pass1');
  });

  it('throws when required env missing', () => {
    assert.throws(
      () => loadConfig({ configPath: fixture, env: {} }),
      (err: unknown) => err instanceof ConfigError,
    );
  });
});
```

Create `tests/fixtures/jobs.valid.json` mirroring `jobs.example.json`.

- [ ] **Step 2: Run test — expect fail**

Run: `npm test`  
Expected: FAIL — `loadConfig` missing

- [ ] **Step 3: Implement `src/config.ts`**

Implement:
- Read JSON from `configPath` (default: `jobs.json` in cwd)
- Validate required top-level keys and job fields with explicit checks (no zod required for v1)
- Defaults: `browser.headless=true`, `timeoutMs=60000`, `saveErrorScreenshot=true`, `ntfy.baseUrl=https://ntfy.sh`, `ntfy.priority=default`, `mistral.model=mistral-small-latest`
- Resolve env vars; throw `ConfigError` with the missing env name
- Do **not** require TNPDCL creds when loading config globally if those jobs exist — resolve all credential envs for all jobs at load time so misconfig fails fast (matches test above)

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts tests/fixtures/jobs.valid.json
git commit -m "feat: load and validate jobs config with env resolution"
```

---

### Task 4: Notify

**Files:**
- Create: `src/notify.ts`
- Create: `tests/notify.test.ts`

**Interfaces:**
- Consumes: `BillResult` (define a minimal duplicate in notify tests OR import from adapters/types — prefer creating `src/adapters/types.ts` first in this task with only `BillResult`, then expand in Task 7)
- Produces:
  - `formatSuccessBody(result: BillResult): string`
  - `formatFailureBody(jobId: string, err: { code?: string; message: string }, screenshotPath?: string): string`
  - `sendNtfy(opts: { baseUrl: string; topic: string; title: string; body: string; priority?: string; fetchImpl?: typeof fetch }): Promise<void>`
  - Retries once on network error or HTTP 5xx; throws `NotifyError` otherwise

- [ ] **Step 1: Create `src/adapters/types.ts` with `BillResult` only**

```ts
export type BillResult = {
  provider: string;
  amount: string;
  dueDate?: string;
  billPeriod?: string;
  status?: string;
  accountLabel: string;
  rawNotes?: string;
};
```

- [ ] **Step 2: Write failing tests for formatting**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSuccessBody, formatFailureBody } from '../src/notify.ts';

describe('notify formatters', () => {
  it('formats success body fields', () => {
    const body = formatSuccessBody({
      provider: 'tnpdcl',
      amount: '₹1,234.00',
      dueDate: '2026-08-20',
      billPeriod: 'Jun-Jul 2026',
      status: 'unpaid',
      accountLabel: '****5643',
    });
    assert.match(body, /₹1,234\.00/);
    assert.match(body, /2026-08-20/);
    assert.match(body, /Jun-Jul 2026/);
    assert.match(body, /unpaid/);
    assert.match(body, /\*\*\*\*5643/);
  });

  it('formats failure body with code', () => {
    const body = formatFailureBody('home-eb', { code: 'LoginError', message: 'bad credentials' });
    assert.match(body, /home-eb/);
    assert.match(body, /LoginError/);
    assert.match(body, /bad credentials/);
  });
});
```

- [ ] **Step 3: Implement formatters + `sendNtfy`**

`sendNtfy` POST to `${baseUrl.replace(/\/$/, '')}/${topic}` with headers:
- `Title`: title
- `Priority`: priority ?? `default`
- `Content-Type`: `text/plain`
Body = plain text body.

On first failure (throw from fetch or status >= 500), wait 250ms and retry once. On 4xx, throw immediately with response text.

- [ ] **Step 4: Add test for retry using mock fetch**

```ts
it('retries once on 502 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response('bad gateway', { status: 502 });
    return new Response('ok', { status: 200 });
  };
  await sendNtfy({
    baseUrl: 'https://ntfy.sh',
    topic: 't',
    title: 'hi',
    body: 'body',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  assert.equal(calls, 2);
});
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/types.ts src/notify.ts tests/notify.test.ts
git commit -m "feat: format and send ntfy notifications with retry"
```

---

### Task 5: Captcha (Mistral vision)

**Files:**
- Create: `src/captcha.ts`
- Create: `tests/captcha.test.ts`

**Interfaces:**
- Consumes: `CaptchaError`, mistral config
- Produces:
  - `type CaptchaSolver = { solveFromImageBase64(base64Png: string): Promise<string> }`
  - `createMistralCaptchaSolver(opts: { apiKey: string; model: string; complete?: CompleteFn }): CaptchaSolver`
  - `CompleteFn` injectable so tests never hit the network
  - Normalization: trim, strip spaces/quotes, reject empty or length > 12 → `CaptchaError`

Prompt (exact):

```text
Read the captcha image. Reply with only the captcha characters. No spaces, no punctuation, no explanation.
```

- [ ] **Step 1: Write failing test with fake completer**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMistralCaptchaSolver } from '../src/captcha.ts';
import { CaptchaError } from '../src/errors.ts';

describe('captcha solver', () => {
  it('returns normalized text from model', async () => {
    const solver = createMistralCaptchaSolver({
      apiKey: 'x',
      model: 'mistral-small-latest',
      complete: async () => ' Ab12 ',
    });
    const text = await solver.solveFromImageBase64('aaa');
    assert.equal(text, 'Ab12');
  });

  it('throws CaptchaError on empty', async () => {
    const solver = createMistralCaptchaSolver({
      apiKey: 'x',
      model: 'mistral-small-latest',
      complete: async () => '   ',
    });
    await assert.rejects(() => solver.solveFromImageBase64('aaa'), CaptchaError);
  });
});
```

- [ ] **Step 2: Implement `src/captcha.ts`**

Default `complete` uses `@mistralai/mistralai` `chat.complete` with multimodal content:
- text part = prompt above
- image_url = `data:image/png;base64,${base64Png}`

Return `message.content` as string (handle array content if SDK returns parts — concatenate text parts).

Also export helper used by adapters:

```ts
export async function solveCaptchaFromLocator(
  locator: { screenshot: (opts?: { type?: 'png' }) => Promise<Buffer> },
  solver: CaptchaSolver,
): Promise<string> {
  const buf = await locator.screenshot({ type: 'png' });
  return solver.solveFromImageBase64(buf.toString('base64'));
}
```

- [ ] **Step 3: Run tests — expect pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/captcha.ts tests/captcha.test.ts
git commit -m "feat: solve captchas via Mistral vision with injectable client"
```

---

### Task 6: Browser helper

**Files:**
- Create: `src/browser.ts`
- Create: `tests/browser.test.ts`

**Interfaces:**
- Consumes: `BrowserConfig`, `TimeoutError`
- Produces:
  - `withBrowser<T>(config: BrowserConfig, fn: (page: Page) => Promise<T>): Promise<T>`
  - Launches chromium with args from spec; creates context+page; runs `fn`; closes in `finally`
  - Sets default timeout from `config.timeoutMs`

Launch args:
```ts
const args = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--js-flags=--max-old-space-size=128',
];
if (config.noSandbox) args.push('--no-sandbox');
```

Viewport: `{ width: 1280, height: 720 }`

- [ ] **Step 1: Write smoke test**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withBrowser } from '../src/browser.ts';

describe('withBrowser', () => {
  it('opens a page and closes cleanly', async () => {
    const title = await withBrowser(
      { headless: true, timeoutMs: 30000, saveErrorScreenshot: false },
      async (page) => {
        await page.setContent('<html><head><title>ok</title></head><body>hi</body></html>');
        return page.title();
      },
    );
    assert.equal(title, 'ok');
  });
});
```

- [ ] **Step 2: Implement `src/browser.ts` using `playwright.chromium.launch`**

- [ ] **Step 3: Run test — expect pass**

Run: `npm test -- tests/browser.test.ts`  
Expected: PASS (requires Chromium from postinstall)

- [ ] **Step 4: Commit**

```bash
git add src/browser.ts tests/browser.test.ts
git commit -m "feat: add low-RAM Playwright browser lifecycle helper"
```

---

### Task 7: Dummy adapter + registry

**Files:**
- Create: `fixtures/dummy-bill.html`
- Modify: `src/adapters/types.ts` (add `AdapterContext`, `BillingAdapter`)
- Create: `src/adapters/dummy.ts`
- Create: `src/adapters/registry.ts`
- Create: `tests/dummy-adapter.test.ts`

**Interfaces:**
- Consumes: `BillResult`, browser helper, logger, captcha solver type (optional unused by dummy)
- Produces:
  - `BillingAdapter` + `AdapterContext`
  - `dummyAdapter: BillingAdapter` with `id: 'dummy'`
  - `getAdapter(provider: string): BillingAdapter` throws `ConfigError` if unknown
  - `registerDefaultAdapters()` or static map including `dummy` (and later `tnpdcl`)

```ts
export type AdapterContext = {
  page: import('playwright').Page;
  credentials: Record<string, string>;
  captchaSolver: import('../captcha.ts').CaptchaSolver;
  timeoutMs: number;
  logger: import('../logger.ts').Logger;
  fixturePath?: string; // used by dummy
};

export interface BillingAdapter {
  id: string;
  run(ctx: AdapterContext): Promise<BillResult>;
}
```

- [ ] **Step 1: Create fixture HTML**

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Dummy Bill</title></head>
  <body>
    <h1>Dummy Provider</h1>
    <p data-testid="amount">₹999.00</p>
    <p data-testid="due-date">2026-08-31</p>
    <p data-testid="bill-period">Aug 2026</p>
    <p data-testid="status">unpaid</p>
    <p data-testid="account">1234567890</p>
  </body>
</html>
```

- [ ] **Step 2: Implement dummy adapter**

- `page.goto('file://' + absoluteFixturePath)`
- Read testids
- Mask account as last 4 digits: `****7890`
- Return `BillResult` with `provider: 'dummy'`

- [ ] **Step 3: Write test using `withBrowser`**

Assert amount `₹999.00` and masked account.

- [ ] **Step 4: Implement registry with `dummy` only for now**

```ts
const adapters = new Map<string, BillingAdapter>();
export function registerAdapter(adapter: BillingAdapter) {
  adapters.set(adapter.id, adapter);
}
export function getAdapter(provider: string): BillingAdapter {
  const adapter = adapters.get(provider);
  if (!adapter) throw new ConfigError(`Unknown provider: ${provider}`);
  return adapter;
}
export function registerBuiltInAdapters() {
  registerAdapter(dummyAdapter);
}
```

Call `registerBuiltInAdapters()` from job-runner/cli startup.

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```bash
git add fixtures/dummy-bill.html src/adapters/types.ts src/adapters/dummy.ts src/adapters/registry.ts tests/dummy-adapter.test.ts
git commit -m "feat: add dummy billing adapter and registry"
```

---

### Task 8: Job runner

**Files:**
- Create: `src/job-runner.ts`
- Create: `tests/job-runner.test.ts`

**Interfaces:**
- Consumes: config, browser, notify, captcha, registry, errors, logger
- Produces:
  - `runJob(app: AppConfig, job: JobConfig, deps?: Partial<RunnerDeps>): Promise<{ ok: true; result: BillResult } | { ok: false; error: AppError }>`
  - `runJobs(app: AppConfig, jobIds: 'all' | string[], deps?: Partial<RunnerDeps>): Promise<{ failed: number }>`
  - On success: `sendNtfy` success
  - On failure: optional screenshot to `tmp/{jobId}-{timestamp}.png` if `saveErrorScreenshot`, then failure ntfy
  - `--all` semantics: continue after failures; return count of failures
  - Always close browser via `withBrowser`

`RunnerDeps` allows injecting `withBrowser`, `sendNtfy`, `createMistralCaptchaSolver`, `getAdapter` for unit tests.

Lifecycle inside `runJob`:
1. `logger.info('job start')`
2. `withBrowser` → build `AdapterContext` → `adapter.run`
3. success notify
4. catch → map unknown errors to `AppError` when possible → screenshot → failure notify → return `{ ok: false }`

- [ ] **Step 1: Write unit test with fake adapter + fake notify/browser**

Register a fake adapter `fake` that returns a fixed `BillResult`. Inject deps so no Playwright/Mistral/network. Assert notify called with success title/body.

Second test: adapter throws `LoginError` → failure notify called, result `ok: false`.

- [ ] **Step 2: Implement `src/job-runner.ts`**

- [ ] **Step 3: Run tests — expect pass**

- [ ] **Step 4: Commit**

```bash
git add src/job-runner.ts tests/job-runner.test.ts
git commit -m "feat: orchestrate job lifecycle with success/failure notify"
```

---

### Task 9: CLI

**Files:**
- Create: `src/cli.ts`

**Interfaces:**
- Consumes: `loadConfig`, `runJobs`, `registerBuiltInAdapters`, dotenv
- Produces: executable CLI

```text
billing-agent run --job <id>
billing-agent run --all
billing-agent daemon
billing-agent run --config path/to/jobs.json ...
```

- [ ] **Step 1: Implement Commander program**

```ts
#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { runJobs } from './job-runner.js';
import { registerBuiltInAdapters } from './adapters/registry.js';
import { startDaemon } from './scheduler.js';

registerBuiltInAdapters();

const program = new Command();
program.name('billing-agent').description('Cron-friendly billing notifier');

program
  .command('run')
  .requiredOption('--config <path>', 'path to jobs.json', 'jobs.json')
  .option('--job <id>', 'run a single job id')
  .option('--all', 'run all enabled jobs')
  .action(async (opts) => {
    if (!opts.job && !opts.all) {
      console.error('Specify --job <id> or --all');
      process.exit(2);
    }
    const app = loadConfig({ configPath: opts.config });
    const ids = opts.all ? 'all' : [opts.job as string];
    const { failed } = await runJobs(app, ids);
    process.exit(failed > 0 ? 1 : 0);
  });

program
  .command('daemon')
  .requiredOption('--config <path>', 'path to jobs.json', 'jobs.json')
  .action(async (opts) => {
    const app = loadConfig({ configPath: opts.config });
    await startDaemon(app);
  });

program.parseAsync(process.argv);
```

Note: `startDaemon` lands in Task 10 — for this task, create a stub in `src/scheduler.ts` that throws `Error('daemon not implemented')` **or** implement Task 10 immediately after in the same session. Prefer stub only if splitting commits; otherwise implement Task 10 before committing CLI.

- [ ] **Step 2: `npm run build` and verify help**

Run: `npm run build && node dist/cli.js --help`  
Expected: shows `run` and `daemon` commands

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add billing-agent CLI entrypoint"
```

---

### Task 10: Daemon scheduler

**Files:**
- Create: `src/scheduler.ts`
- Create: `tests/scheduler.test.ts` (optional light test: jobs without schedule are skipped)

**Interfaces:**
- Consumes: `AppConfig`, `runJobs`
- Produces: `startDaemon(app: AppConfig): Promise<void>` — registers cron for each enabled job with non-null `schedule`; logs and keeps process alive

```ts
import cron from 'node-cron';
import { runJobs } from './job-runner.js';
import { createLogger } from './logger.js';

export async function startDaemon(app: AppConfig): Promise<void> {
  const log = createLogger();
  for (const job of app.jobs) {
    if (!job.enabled || !job.schedule) continue;
    if (!cron.validate(job.schedule)) {
      throw new ConfigError(`Invalid cron schedule for job ${job.id}: ${job.schedule}`);
    }
    cron.schedule(job.schedule, () => {
      void runJobs(app, [job.id]).catch((err) => {
        log.error('scheduled job failed', { jobId: job.id, err: String(err) });
      });
    });
    log.info('scheduled job', { jobId: job.id, schedule: job.schedule });
  }
  log.info('daemon running');
  await new Promise(() => {
    /* keep alive */
  });
}
```

- [ ] **Step 1: Implement + wire into CLI (replace stub)**

- [ ] **Step 2: Manual sanity** — start daemon briefly with a schedule like `*/1 * * * *` against dummy job only if desired; Ctrl+C. Not required for CI.

- [ ] **Step 3: Commit**

```bash
git add src/scheduler.ts src/cli.ts
git commit -m "feat: add optional cron daemon mode"
```

---

### Task 11: TNPDCL adapter

**Files:**
- Create: `src/adapters/tnpdcl.ts`
- Modify: `src/adapters/registry.ts` (register `tnpdcl`)
- Create: `tests/tnpdcl-mask.test.ts` (unit-test pure helpers only)

**Interfaces:**
- Consumes: AdapterContext, captcha helper, LoginError/ScrapeError/CaptchaError
- Produces: `tnpdclAdapter` with `id: 'tnpdcl'`

**Flow (implement with resilient selectors; adjust after manual run):**

1. `page.goto('https://www.tnebnet.org/awp/login', { waitUntil: 'domcontentloaded' })`
2. Fill username/password using labels/placeholders/name attributes common on the portal (inspect live DOM during implementation; keep selectors as named constants at top of file)
3. Locate captcha `<img>` (often near “Enter the below text”); `solveCaptchaFromLocator` → fill captcha input
4. Click login
5. Detect failure (still on login page / error text) → throw `LoginError` / `CaptchaError`
6. Navigate to bill summary if not already visible; scrape fields into `BillResult`
7. Export `maskAccount(id: string): string` for unit test (`1234567890` → `****7890`)

**Retry:** job-runner already retries captcha/login once **or** implement retry loop inside adapter (max 2 attempts). Prefer **inside adapter** so dummy is unaffected:

```ts
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    return await attemptLoginAndScrape(ctx);
  } catch (err) {
    if (attempt === 2 || !(err instanceof CaptchaError || err instanceof LoginError)) throw err;
    ctx.logger.warn('login/captcha retry', { attempt });
  }
}
```

- [ ] **Step 1: Write unit test for `maskAccount`**

- [ ] **Step 2: Implement adapter with clearly commented selector constants**

During implementation, open the live login page once (headed if needed) to lock selectors. If a field cannot be found reliably, throw `ScrapeError` with the missing field name.

- [ ] **Step 3: Register in registry**

- [ ] **Step 4: Manual verification checklist (do not automate in CI)**

1. Copy `jobs.example.json` → `jobs.json`, fill `.env`
2. `npm run build && node dist/cli.js run --job home-eb`
3. Confirm ntfy success or actionable failure message

- [ ] **Step 5: Commit**

```bash
git add src/adapters/tnpdcl.ts src/adapters/registry.ts tests/tnpdcl-mask.test.ts
git commit -m "feat: add TNPDCL billing adapter with Mistral captcha login"
```

---

### Task 12: End-to-end smoke docs + README

**Files:**
- Modify: `README.md`
- Create: `jobs.json` is NOT committed — document copy step
- Ensure `tmp/` gitignored (Task 1)

**Interfaces:**
- Consumes: working CLI
- Produces: documented usage

- [ ] **Step 1: Run dummy smoke (requires ntfy topic)**

```bash
cp jobs.example.json jobs.json
# set NTFY_TOPIC in .env (Mistral not required for dummy)
npm run build
node dist/cli.js run --job smoke-test
```

Expected: exit 0; ntfy message received with ₹999.00

If ntfy cannot be used in the agent environment, run with a mock by temporarily pointing tests — for human verification, real ntfy is required per success criteria.

- [ ] **Step 2: Write README**

Include:
- What it does
- RAM note (short-lived Chromium; not true 256MB)
- Setup: Node 20+, `npm install`, copy example config/env, `npx playwright install chromium` if postinstall skipped
- Commands: `run --job`, `run --all`, `daemon`
- Cron example: `0 9 * * * cd /path/to/billing-agent && node dist/cli.js run --job home-eb`
- Adding adapters: new file under `src/adapters/`, register in registry
- Security: keep `jobs.json` / `.env` private

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document billing-agent setup, cron, and adapters"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| CLI one-shot + daemon | 9, 10 |
| jobs.json + env hybrid secrets | 1, 3 |
| Named adapters dummy + tnpdcl | 7, 11 |
| Playwright chromium low-RAM lifecycle | 6 |
| Mistral captcha OCR + 1 retry | 5, 11 |
| ntfy success/failure + retry | 4, 8 |
| Error classes + screenshots to tmp/ | 2, 8 |
| Unit + dummy smoke; no live TNPDCL CI | 3–8, 11 manual |
| kebab-case files / tsc → dist | 1 + all src paths |
| Success criteria smoke-test | 12 |

**Placeholder scan:** none intentional; TNPDCL selectors must be confirmed against live DOM in Task 11 (called out explicitly, not TBD).

**Type consistency:** `BillResult`, `AppConfig`, `JobConfig`, `AdapterContext`, `CaptchaSolver`, `BillingAdapter` names are stable across tasks.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-08-billing-agent.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
