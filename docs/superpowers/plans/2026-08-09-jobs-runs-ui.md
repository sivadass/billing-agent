# Jobs & Runs Operator UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Cleanplate React Router SPA for Jobs | Runs | Status hubs, plus `POST /jobs/:id/run` wired through the worker daemon so operators can manage jobs and watch live run status.

**Architecture:** Web talks to the existing Bearer API. New trigger endpoint calls injected `onRunJob`, which starts `runJob` and resolves with `runId` as soon as `createRun` finishes (via `onRunCreated`). UI polls run detail every ~2s while status is `running`.

**Tech Stack:** Vite, React 18, TypeScript, Cleanplate, `react-router-dom`, SCSS modules, Vitest + Testing Library; `@billing-agent/api` (Node `http` + `node:test`); `@billing-agent/core` job-runner; worker daemon

**Spec:** `docs/superpowers/specs/2026-08-09-jobs-runs-ui-design.md`

## Global Constraints

- Filenames: kebab-case only; React export names may be PascalCase
- Credentials: env **names** only (`credentialsEnv`); never secret values
- Schedule: humanize in tables; edit as raw cron (`null`/empty = manual)
- Soft-disable only (`DELETE /jobs/:id`); disabled jobs stay listed
- No websockets; poll run detail ~2s while `running`
- Prefer Cleanplate props for spacing (suffix-only); SCSS modules for layout
- Jobs and Runs `Table`s **must** set `mobileColumns` so viewport &lt; 768px renders Cleanplate `MediaObject` cards (never rely on the default narrow table)
- Never log or render the full API token
- Match `POST /jobs/:jobId/run` **before** generic `/jobs/:id` handlers

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/core/src/job-runner.ts` | Optional `onRunCreated(runId)` after `createRun` |
| `packages/core/tests/job-runner.test.ts` | Assert `onRunCreated` fires with store |
| `apps/api/src/server.ts` | `onRunJob?: (jobId: string) => Promise<string>` |
| `apps/api/src/routes.ts` | `POST /jobs/:id/run` + pass `onRunJob` in context |
| `apps/api/tests/api.test.ts` | Run-trigger cases; fix `MemoryStore.listRuns` filters |
| `apps/worker/src/cli.ts` | Daemon wires `onRunJob` |
| `apps/web/package.json` | Add `react-router-dom` |
| `apps/web/src/app.tsx` | `BrowserRouter`, `AppShell`, routes |
| `apps/web/src/pages/jobs-page.tsx` | Jobs hub |
| `apps/web/src/pages/job-form-page.tsx` | Create/edit form |
| `apps/web/src/pages/runs-page.tsx` | Runs hub |
| `apps/web/src/pages/run-detail-page.tsx` | Detail + polling |
| `apps/web/src/pages/status-page.tsx` | Moved status probes |
| `apps/web/src/components/jobs-table.tsx` | Jobs table + actions |
| `apps/web/src/components/runs-table.tsx` | Runs table |
| `apps/web/src/components/credentials-env-editor.tsx` | Key/value env-name editor |
| `apps/web/src/lib/cron-humanize.ts` | Cron → English |
| `apps/web/src/lib/jobs-api.ts` | Jobs HTTP helpers |
| `apps/web/src/lib/runs-api.ts` | Runs HTTP helpers |
| `apps/web/src/lib/*.test.ts` | Unit tests for helpers / critical UI |
| `apps/web/README.md` | Document hubs + Run now |

---

### Task 1: Early `runId` via `onRunCreated`

**Files:**
- Modify: `packages/core/src/job-runner.ts`
- Modify: `packages/core/tests/job-runner.test.ts`

**Interfaces:**
- Consumes: existing `runJob(app, job, deps)`
- Produces: `RunnerDeps.onRunCreated?: (runId: string) => void` — called once after run id is assigned and `createRun` has completed when `store` is set (still called when no store, immediately after id generation)

- [x] **Step 1: Write the failing test**

Add inside `describe('runJob', ...)` in `packages/core/tests/job-runner.test.ts`:

```ts
it('invokes onRunCreated with run id after createRun', async () => {
  const created: string[] = [];
  const runs: RunDocument[] = [];
  const store = {
    async createRun(run: RunDocument) {
      runs.push(run);
    },
    async finishRun() {},
    async listActiveOverlays() {
      return [];
    },
  } as unknown as BillingStore;

  const adapter: BillingAdapter = {
    id: 'fake',
    async run() {
      return billResult;
    },
  };

  await runJob(app, job, {
    env: testEnv,
    store,
    getAdapter: () => adapter,
    withBrowser: async (_browser, fn) => fn({} as Page),
    sendNtfy: async () => {},
    onRunCreated: (runId) => created.push(runId),
    proposeOverlayPatch: async () => {
      throw new ConfigError('unused');
    },
  });

  assert.equal(created.length, 1);
  assert.equal(created[0], runs[0]?.id);
});
```

Import `RunDocument` from `../src/store/types.ts` if not already imported.

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/core/tests/job-runner.test.ts`

Expected: FAIL — `onRunCreated` is not a known dep / never called (or TypeScript error if strictly typed before implementation).

- [x] **Step 3: Implement `onRunCreated`**

In `packages/core/src/job-runner.ts`, extend `RunnerDeps`:

```ts
export type RunnerDeps = {
  withBrowser: typeof withBrowser;
  sendNtfy: typeof sendNtfy;
  createMistralCaptchaSolver: typeof createMistralCaptchaSolver;
  getAdapter: (provider: string) => BillingAdapter;
  env: NodeJS.ProcessEnv;
  store?: BillingStore;
  onRunCreated?: (runId: string) => void;
  proposeOverlayPatch: (
    input: Parameters<typeof proposeOverlayPatchWithDeps>[0],
  ) => Promise<Awaited<ReturnType<typeof proposeOverlayPatchWithDeps>>>;
  extractCompactDom: typeof extractCompactDom;
};
```

Immediately after the `createRun` block (and still after `runId` is created when there is no store), call:

```ts
  if (runnerDeps.store) {
    await runnerDeps.store.createRun({
      id: runId,
      // ...existing fields...
    });
  }

  runnerDeps.onRunCreated?.(runId);
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test packages/core/tests/job-runner.test.ts`

Expected: PASS (including the new test).

- [x] **Step 5: Commit**

```bash
git add packages/core/src/job-runner.ts packages/core/tests/job-runner.test.ts
git commit -m "feat(core): notify onRunCreated after run record is created"
```

---

### Task 2: `POST /jobs/:jobId/run` API

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes.ts`
- Modify: `apps/api/tests/api.test.ts`

**Interfaces:**
- Consumes: `BillingStore`, Task 1 `onRunCreated` (via worker later)
- Produces:
  - `StartServerInput.onRunJob?: (jobId: string) => Promise<string>`
  - `RouteContext.onRunJob?: (jobId: string) => Promise<string>`
  - `POST /jobs/:jobId/run` → 202 `{ id: string }` | 404 | 409 | 503

- [x] **Step 1: Fix `MemoryStore.listRuns` and write failing run-trigger tests**

Replace `MemoryStore.listRuns` in `apps/api/tests/api.test.ts` with:

```ts
  async listRuns(options?: { jobId?: string; limit?: number }): Promise<RunDocument[]> {
    let runs = [...this.runs.values()];
    if (options?.jobId) {
      runs = runs.filter((run) => run.jobId === options.jobId);
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (options?.limit && options.limit > 0) {
      return runs.slice(0, options.limit);
    }
    return runs;
  }
```

Append:

```ts
describe('POST /jobs/:id/run', () => {
  const enabledJob: JobDocument = {
    id: 'home-eb',
    provider: 'dummy',
    enabled: true,
    schedule: null,
    credentialsEnv: {},
    notify: { title: 'Bill' },
  };

  it('returns 503 when onRunJob is not configured', async () => {
    const store = new MemoryStore();
    await store.upsertJob(enabledJob);
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store,
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 503);
  });

  it('returns 202 with run id from onRunJob', async () => {
    const store = new MemoryStore();
    await store.upsertJob(enabledJob);
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store,
      onRunJob: async () => 'run-123',
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 202);
    const body = (await response.json()) as { id: string };
    assert.equal(body.id, 'run-123');
  });

  it('returns 404 when job is missing', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
      onRunJob: async () => 'run-x',
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/missing/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 404);
  });

  it('returns 409 when job is disabled', async () => {
    const store = new MemoryStore();
    await store.upsertJob({ ...enabledJob, enabled: false });
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store,
      onRunJob: async () => 'run-x',
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 409);
  });

  it('returns 409 when a run is already running', async () => {
    const store = new MemoryStore();
    await store.upsertJob(enabledJob);
    await store.createRun({
      id: 'existing',
      jobId: 'home-eb',
      provider: 'dummy',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      screenshotPath: null,
      recoveryAttempted: false,
      recoverySucceeded: false,
      overlayActivated: false,
      billSummary: null,
    });
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store,
      onRunJob: async () => 'run-x',
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 409);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test apps/api/tests/api.test.ts`

Expected: FAIL on new cases (404 from unknown route or missing `onRunJob` typing).

- [x] **Step 3: Implement server + route**

`apps/api/src/server.ts`:

```ts
export type StartServerInput = {
  port: number;
  token: string;
  store: BillingStore;
  corsOrigins?: string[];
  onRunJob?: (jobId: string) => Promise<string>;
};

// in createServer handler:
void handleRoute(req, res, {
  token: input.token,
  store: input.store,
  onRunJob: input.onRunJob,
}).catch(/* existing */);
```

`apps/api/src/routes.ts` — extend `RouteContext` with `onRunJob?: (jobId: string) => Promise<string>`.

**Before** the generic `GET/PATCH/DELETE` `/jobs/:id` branches, add:

```ts
  if (method === 'POST' && pathname.startsWith('/jobs/') && pathname.endsWith('/run')) {
    const jobId = decodeURIComponent(pathname.slice('/jobs/'.length, -'/run'.length));
    if (!ctx.onRunJob) {
      sendJson(res, 503, { error: 'Runner unavailable' });
      return;
    }
    const job = await ctx.store.getJob(jobId);
    if (!job) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    if (!job.enabled) {
      sendJson(res, 409, { error: 'Job disabled' });
      return;
    }
    const recent = await ctx.store.listRuns({ jobId, limit: 20 });
    if (recent.some((run) => run.status === 'running')) {
      sendJson(res, 409, { error: 'Job already running' });
      return;
    }
    const runId = await ctx.onRunJob(jobId);
    sendJson(res, 202, { id: runId });
    return;
  }
```

Ensure path parsing does not leave a trailing slash; job ids must not contain `/`.

- [x] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test apps/api/tests/api.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/routes.ts apps/api/tests/api.test.ts
git commit -m "feat(api): add POST /jobs/:id/run trigger endpoint"
```

---

### Task 3: Wire `onRunJob` in worker daemon

**Files:**
- Modify: `apps/worker/src/cli.ts`

**Interfaces:**
- Consumes: `runJob`, `loadConfigFromStore`, `onRunCreated`, `startServer({ onRunJob })`
- Produces: Daemon `onRunJob(jobId)` that returns `runId` after create, while scrape continues

- [x] **Step 1: Implement daemon `onRunJob`**

In the `daemon` action, import `runJob` from `@billing-agent/core` (in addition to existing imports). Replace `startServer` call with:

```ts
    const server = await startServer({
      port: resolveHttpPort(),
      token: requireApiToken(),
      store,
      corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
      onRunJob: async (jobId: string) => {
        const latest = await loadConfigFromStore(store);
        const job = latest.jobs.find((item) => item.id === jobId);
        if (!job) {
          throw new ConfigError(`Unknown job id: ${jobId}`);
        }

        return await new Promise<string>((resolve, reject) => {
          let reported = false;
          void runJob(latest, job, {
            store,
            onRunCreated: (runId) => {
              reported = true;
              resolve(runId);
            },
          }).catch((error: unknown) => {
            if (!reported) {
              reject(error instanceof Error ? error : new Error(String(error)));
              return;
            }
            console.error(
              `[daemon] run for ${jobId} failed after start:`,
              error instanceof Error ? error.message : error,
            );
          });
        });
      },
    });
```

Keep `startDaemon(app, { store })` as today (scheduler uses initial `app`; generation bumps already reload via store — do not change scheduler in this task unless required for compile).

- [x] **Step 2: Typecheck worker**

Run: `npm run build -w @billing-agent/worker` (or the workspace’s equivalent `tsc` script)

Expected: PASS / emit succeeds.

- [x] **Step 3: Commit**

```bash
git add apps/worker/src/cli.ts
git commit -m "feat(worker): wire onRunJob for manual API runs"
```

---

### Task 4: React Router shell (Jobs | Runs | Status)

**Files:**
- Modify: `apps/web/package.json` (add `react-router-dom`)
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.module.scss` (as needed)
- Create: `apps/web/src/pages/status-page.tsx` (move from components)
- Create: `apps/web/src/pages/status-page.module.scss` (move)
- Create: `apps/web/src/pages/jobs-page.tsx` (stub)
- Create: `apps/web/src/pages/runs-page.tsx` (stub)
- Create: `apps/web/src/app-shell.test.tsx`
- Delete or re-export: old `apps/web/src/components/status-page.tsx` after move

**Interfaces:**
- Consumes: Cleanplate `AppShell` / `Header`, `TokenGate`
- Produces: Routes `/` → `/jobs`, `/jobs`, `/runs`, `/status` (stubs OK except status)

- [x] **Step 1: Install dependency**

```bash
npm install react-router-dom -w @billing-agent/web
```

- [x] **Step 2: Write failing router smoke test**

`apps/web/src/app-shell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';

vi.mock('./lib/auth-token', async () => {
  const actual = await vi.importActual<typeof import('./lib/auth-token')>('./lib/auth-token');
  return {
    ...actual,
    getApiToken: () => 'test-token',
    getApiBaseUrl: () => 'http://127.0.0.1:8080',
  };
});

describe('App shell routes', () => {
  it('renders Jobs hub at /jobs', () => {
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /jobs/i })).toBeInTheDocument();
  });
});
```

Note: If `App` already wraps `BrowserRouter`, export an `AppRoutes` component and test that inside `MemoryRouter`, or accept `router` prop. Prefer:

```tsx
// app.tsx
export function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export function AppLayout() { /* shell + Routes */ }
```

and test `AppLayout` with `MemoryRouter`.

- [x] **Step 3: Run test to verify it fails**

Run: `npm run test -w @billing-agent/web -- src/app-shell.test.tsx`

Expected: FAIL (no Jobs heading / no router).

- [x] **Step 4: Implement shell**

Move status page files into `pages/`. Stub jobs/runs pages with `PageHeader` / `Typography` title “Jobs” / “Runs”.

Wire `AppShell` + `Header` `menuItems`:

```ts
const MENU = [
  { label: 'Jobs', value: '/jobs', icon: 'work' as const },
  { label: 'Runs', value: '/runs', icon: 'history' as const },
  { label: 'Status', value: '/status', icon: 'monitor_heart' as const },
];
```

Use `useNavigate` / `useLocation` for active item + navigation. Include `TokenGate` in header right or above outlet. Routes:

```tsx
<Routes>
  <Route path="/" element={<Navigate to="/jobs" replace />} />
  <Route path="/jobs" element={<JobsPage />} />
  <Route path="/jobs/new" element={<JobFormPage />} /> {/* stub until Task 7 */}
  <Route path="/jobs/:jobId" element={<JobFormPage />} />
  <Route path="/runs" element={<RunsPage />} />
  <Route path="/runs/:runId" element={<RunDetailPage />} /> {/* stub until Task 9 */}
  <Route path="/status" element={<StatusPage />} />
</Routes>
```

Minimal stubs for form/detail pages are fine (`Typography` placeholder) until later tasks fill them in — create empty stub files in this task so routes compile.

- [x] **Step 5: Run tests**

Run: `npm run test -w @billing-agent/web`

Expected: PASS (including existing token/api-client tests).

- [x] **Step 6: Commit**

```bash
git add apps/web/package.json package-lock.json apps/web/src
git commit -m "feat(web): add AppShell routes for Jobs, Runs, and Status"
```

---

### Task 5: `cron-humanize` helper

**Files:**
- Create: `apps/web/src/lib/cron-humanize.ts`
- Create: `apps/web/src/lib/cron-humanize.test.ts`

**Interfaces:**
- Consumes: cron string | null
- Produces: `humanizeCron(schedule: string | null | undefined): string`

- [x] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { humanizeCron } from './cron-humanize';

describe('humanizeCron', () => {
  it('returns Manual only for null/empty', () => {
    expect(humanizeCron(null)).toBe('Manual only');
    expect(humanizeCron('')).toBe('Manual only');
    expect(humanizeCron(undefined)).toBe('Manual only');
  });

  it('humanizes daily at hour patterns', () => {
    expect(humanizeCron('0 9 * * *')).toBe('Every day at 9:00 AM');
    expect(humanizeCron('30 14 * * *')).toBe('Every day at 2:30 PM');
  });

  it('falls back to raw cron when unrecognized', () => {
    expect(humanizeCron('*/5 * * * *')).toBe('*/5 * * * *');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -w @billing-agent/web -- src/lib/cron-humanize.test.ts`

Expected: FAIL — module missing.

- [x] **Step 3: Implement**

```ts
function formatClock(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** Display helper only — forms still edit raw cron. */
export function humanizeCron(schedule: string | null | undefined): string {
  if (schedule == null || schedule.trim() === '') return 'Manual only';
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (
    /^\d+$/.test(minute!) &&
    /^\d+$/.test(hour!) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `Every day at ${formatClock(Number(hour), Number(minute))}`;
  }

  return schedule;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -w @billing-agent/web -- src/lib/cron-humanize.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/cron-humanize.ts apps/web/src/lib/cron-humanize.test.ts
git commit -m "feat(web): humanize common daily cron schedules for display"
```

---

### Task 6: Jobs & runs API client helpers

**Files:**
- Create: `apps/web/src/lib/jobs-api.ts`
- Create: `apps/web/src/lib/runs-api.ts`
- Create: `apps/web/src/lib/jobs-api.test.ts`
- Create: `apps/web/src/lib/types.ts` (shared `JobDocument` / `RunDocument` mirrors)

**Interfaces:**
- Consumes: `apiFetch`
- Produces:
  - `listJobs(): Promise<JobDocument[]>`
  - `getJob(id: string): Promise<JobDocument>`
  - `createJob(job: JobDocument): Promise<JobDocument>`
  - `updateJob(id: string, patch: Partial<JobDocument>): Promise<JobDocument>`
  - `disableJob(id: string): Promise<JobDocument>` // DELETE
  - `runJobNow(id: string): Promise<{ id: string }>` // POST …/run → 202
  - `listRuns(options?: { jobId?: string; limit?: number }): Promise<RunDocument[]>`
  - `getRun(id: string): Promise<RunDocument>`
  - Throw `ApiClientError` on non-OK (parse `{ error }` message when present)

Define types locally matching core:

```ts
export type JobDocument = {
  id: string;
  provider: string;
  enabled: boolean;
  schedule: string | null;
  credentialsEnv: Record<string, string>;
  notify: { title: string };
};

export type RunDocument = {
  id: string;
  jobId: string;
  provider: string;
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
  billSummary: Record<string, string> | null;
};
```

- [x] **Step 1: Write failing client tests** (mock `fetch` / `apiFetch`)

Example for `runJobNow`:

```ts
it('posts to /jobs/:id/run and returns id on 202', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'run-1' }), { status: 202 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  // stub env token as in api-client tests
  const result = await runJobNow('home-eb');
  expect(result.id).toBe('run-1');
  expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/jobs/home-eb/run');
});
```

- [x] **Step 2: Run tests — expect FAIL**

- [x] **Step 3: Implement helpers** using `apiFetch` + JSON parse + status checks

- [x] **Step 4: Run tests — expect PASS**

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/jobs-api.ts apps/web/src/lib/runs-api.ts apps/web/src/lib/jobs-api.test.ts
git commit -m "feat(web): add jobs and runs API client helpers"
```

---

### Task 7: Jobs page (table + actions)

**Files:**
- Create: `apps/web/src/components/jobs-table.tsx`
- Create: `apps/web/src/components/jobs-table.module.scss`
- Modify: `apps/web/src/pages/jobs-page.tsx`
- Create: `apps/web/src/pages/jobs-page.test.tsx`

**Interfaces:**
- Consumes: `listJobs`, `runJobNow`, `disableJob`, `updateJob`, `humanizeCron`
- Produces: Jobs hub with Run / Edit / Disable|Enable

- [x] **Step 1: Write failing page test**

Mock `jobs-api` to return one enabled job. Render `JobsPage` inside `MemoryRouter`. Assert schedule humanized text and that clicking Run calls `runJobNow` and navigates (use `createMemoryRouter` + `RouterProvider` or mock `useNavigate`).

- [x] **Step 2: Implement table + page**

Use Cleanplate `PageHeader` (primary CTA → `/jobs/new`), `Table` columns: id, provider, enabled (`Badge`), schedule (`humanizeCron`), notify title, actions (`Button`s).

**Required:** pass `mobileColumns` so &lt;768px uses `MediaObject` cards. Shape row data so mobile slots resolve (string keys and/or resolvers). Example:

```tsx
<Table
  columns={columns}
  data={rows}
  mobileColumns={{
    title: 'id',
    subtitle: (row) => `${row.provider} · ${row.scheduleLabel}`,
    meta: (row) => row.enabledLabel,
    description: 'notifyTitle',
    action: (row) => (
      {/* same Run / Edit / Disable|Enable controls as desktop actions column */}
    ),
  }}
/>
```

Ensure desktop `customRender` cells and mobile `action` stay behaviorally equivalent (Run/Edit/Disable|Enable). Precompute display fields on each row (`scheduleLabel`, `notifyTitle`, `enabledLabel`) so `mobileColumns` keys work without relying on React nodes in row data.

- Disable: `ConfirmDialog` then `disableJob`
- Enable: `updateJob(id, { enabled: true })`
- Run now: disabled when `!job.enabled`; on 202 `navigate(\`/runs/${id}\`)`; on error show `Alert`
- Edit: `navigate(\`/jobs/${id}\`)`

- [x] **Step 3: Tests PASS**

- [x] **Step 4: Commit**

```bash
git add apps/web/src/components/jobs-table.tsx apps/web/src/components/jobs-table.module.scss apps/web/src/pages/jobs-page.tsx apps/web/src/pages/jobs-page.test.tsx
git commit -m "feat(web): implement Jobs hub table and actions"
```

---

### Task 8: Job create/edit form

**Files:**
- Create: `apps/web/src/components/credentials-env-editor.tsx`
- Modify: `apps/web/src/pages/job-form-page.tsx`
- Create: `apps/web/src/pages/job-form-page.test.tsx`

**Interfaces:**
- Consumes: `getJob`, `createJob`, `updateJob`
- Produces: Form for `/jobs/new` and `/jobs/:jobId`

- [x] **Step 1: Failing test** — create submits `POST` payload with `credentialsEnv` and empty schedule → `null`

- [x] **Step 2: Implement**

Fields via `FormControls`:

- `id` (create only; read-only on edit)
- `provider` select options `tnpdcl`, `dummy`
- `enabled` toggle
- `schedule` text (trim empty → `null`)
- `notify.title`
- `CredentialsEnvEditor`: list of `{ key, envName }` with add/remove; serialize to `Record<string, string>`

On save success → `navigate('/jobs')`. Show inline `error` props on invalid required fields.

- [x] **Step 3: Tests PASS + commit**

```bash
git add apps/web/src/components/credentials-env-editor.tsx apps/web/src/pages/job-form-page.tsx apps/web/src/pages/job-form-page.test.tsx
git commit -m "feat(web): add job create and edit form"
```

---

### Task 9: Runs list + run detail polling

**Files:**
- Create: `apps/web/src/components/runs-table.tsx`
- Modify: `apps/web/src/pages/runs-page.tsx`
- Modify: `apps/web/src/pages/run-detail-page.tsx`
- Create: `apps/web/src/pages/run-detail-page.test.tsx`
- Create: `apps/web/src/pages/runs-page.test.tsx` (optional but preferred)

**Interfaces:**
- Consumes: `listRuns`, `getRun`, `listJobs` (for filter options)
- Produces: `/runs` table + `/runs/:runId` polling detail

- [ ] **Step 1: Failing test for polling stop**

```tsx
it('stops polling once status is success', async () => {
  const getRun = vi
    .fn()
    .mockResolvedValueOnce({ id: 'r1', status: 'running', /* …minimal fields */ })
    .mockResolvedValueOnce({ id: 'r1', status: 'success', billSummary: { total: '10' }, /* … */ });
  vi.mocked(runsApi.getRun).mockImplementation(getRun);
  // render RunDetailPage with route param r1, advance fake timers 2s+, assert getRun call count stabilizes and success UI visible
});
```

Use `vi.useFakeTimers()` carefully with Testing Library `waitFor`.

- [ ] **Step 2: Implement Runs page**

Filters: job `FormControls.Select` (all + job ids), status select. Fetch `listRuns({ limit: 100, jobId? })`; client-filter status. `Table` `onRowClick` → `/runs/:id`.

**Required:** set `mobileColumns` for MediaObject cards under 768px:

```tsx
mobileColumns={{
  title: 'id',
  subtitle: (row) => `${row.jobId} · ${row.provider}`,
  meta: (row) => row.statusLabel, // or customRender-equivalent string/node via resolver
  description: (row) => row.timingLabel, // started + duration
}}
```

Precompute `statusLabel` / `timingLabel` on row objects. Keep `onRowClick` for navigation on both desktop rows and mobile cards.

- [ ] **Step 3: Implement Run detail**

Show fields from spec. `useEffect` interval 2000ms while `status === 'running'`; clear on unmount / terminal. Links back to `/runs` and `/jobs/:jobId`.

- [ ] **Step 4: Tests PASS + commit**

```bash
git add apps/web/src/components/runs-table.tsx apps/web/src/pages/runs-page.tsx apps/web/src/pages/run-detail-page.tsx apps/web/src/pages/run-detail-page.test.tsx apps/web/src/pages/runs-page.test.tsx
git commit -m "feat(web): add Runs hub and live run detail polling"
```

---

### Task 10: Docs + final verification

**Files:**
- Modify: `apps/web/README.md`
- Modify: `README.md` (root) if it still describes status-only UI
- Modify: `postman/billing-agent-api.postman-collection.json` — add `POST /jobs/:id/run` request

- [ ] **Step 1: Update README** — document hubs, routes, Run now, humanized schedule, soft-disable, required daemon for triggers

- [ ] **Step 2: Add Postman request** for `POST {{baseUrl}}/jobs/{{jobId}}/run` with Bearer auth

- [ ] **Step 3: Full test suite**

```bash
npm test
npm run build -w @billing-agent/web
npm run build -w @billing-agent/api
npm run build -w @billing-agent/core
```

Expected: all PASS / build OK.

- [ ] **Step 4: Commit**

```bash
git add apps/web/README.md README.md postman/billing-agent-api.postman-collection.json
git commit -m "docs: document jobs/runs UI and Run now API"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Jobs table + humanized schedule | 5, 7 |
| Jobs/Runs `mobileColumns` → MediaObject cards | 7, 9 |
| Create/edit job + credentialsEnv names | 8 |
| Soft-disable / enable; disabled stay listed | 7 |
| Run now → 202 → run detail | 2, 3, 6, 7, 9 |
| Runs table + filters | 9 |
| Run detail polling | 9 |
| Status hub | 4 |
| React Router URLs | 4 |
| `onRunCreated` early id | 1 |
| 404/409/503 run errors | 2, 7 |
| Tests | 1–9 |
| Non-goals respected | — (no hard delete, secrets, websockets, overlays UI) |

## Placeholder / consistency notes

- Response body for Run now is always `{ id: string }` (run document id).
- `onRunJob` return type is `Promise<string>` everywhere (server, worker, tests).
- Job form provider options: `tnpdcl` | `dummy` only in v1.
