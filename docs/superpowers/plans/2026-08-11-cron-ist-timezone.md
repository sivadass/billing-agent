# Cron IST Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daemon cron schedules evaluate in India Standard Time (`Asia/Kolkata`) regardless of host timezone.

**Architecture:** Pass `{ timezone: 'Asia/Kolkata' }` as the third argument to `node-cron`'s `schedule` in `startDaemon`. Widen the injectable `CronScheduler` type so tests can assert the options. Log the timezone when a job is registered.

**Tech Stack:** TypeScript, `node-cron` ^3.0.3, Node.js `node:test` via `tsx --test`

**Spec:** `docs/superpowers/specs/2026-08-11-cron-ist-timezone-design.md`

## Global Constraints

- Hardcode timezone string exactly: `Asia/Kolkata` (IANA name; do not use `IST` or offsets)
- No env var, Mongo settings, or per-job timezone field
- Do not set `process.env.TZ`
- Do not change web UI / `humanizeCron`
- Filenames: kebab-case only
- Do not commit unless the user explicitly asks

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/worker/src/scheduler.ts` | Pass cron timezone options; type + log update |
| `apps/worker/tests/scheduler.test.ts` | Assert schedule is called with `{ timezone: 'Asia/Kolkata' }` |

---

### Task 1: Wire `Asia/Kolkata` into `cron.schedule`

**Files:**
- Modify: `apps/worker/src/scheduler.ts`
- Modify: `apps/worker/tests/scheduler.test.ts`

**Interfaces:**
- Consumes: existing `startDaemon(app, deps)` and `CronScheduler` injection
- Produces:

```ts
type CronScheduleOptions = {
  timezone: string;
};

type CronScheduler = {
  validate(expression: string): boolean;
  schedule(
    expression: string,
    task: () => void,
    options?: CronScheduleOptions,
  ): {
    stop?: () => void;
    destroy?: () => void;
  };
};
```

- [ ] **Step 1: Write the failing test**

Replace `apps/worker/tests/scheduler.test.ts` with:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppConfig } from '@billing-agent/core';
import { startDaemon } from '../src/scheduler.ts';

const baseApp: AppConfig = {
  configPath: '/tmp/jobs.json',
  ntfy: {
    baseUrl: 'https://ntfy.example',
    topic: 'billing',
    priority: 'default',
  },
  mistral: { apiKeyEnv: 'TEST_MISTRAL_API_KEY', model: 'test-model' },
  browser: {
    headless: true,
    timeoutMs: 1_000,
    saveErrorScreenshot: false,
  },
  jobs: [],
  jobsGeneration: 0,
};

describe('startDaemon', () => {
  it('skips jobs without a schedule', async () => {
    const scheduled: string[] = [];
    const app: AppConfig = {
      ...baseApp,
      jobs: [
        {
          id: 'manual-only',
          provider: 'dummy',
          enabled: true,
          schedule: null,
          credentialsEnv: {},
          notify: { title: 'Manual bill' },
        },
      ],
    };

    await startDaemon(app, {
      cron: {
        validate: () => true,
        schedule: (expression) => {
          scheduled.push(expression);
          return {} as never;
        },
      },
      keepAlive: async () => {},
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    assert.deepEqual(scheduled, []);
  });

  it('schedules enabled jobs with Asia/Kolkata timezone', async () => {
    const calls: Array<{
      expression: string;
      options: unknown;
    }> = [];
    const app: AppConfig = {
      ...baseApp,
      jobs: [
        {
          id: 'daily-check',
          provider: 'dummy',
          enabled: true,
          schedule: '0 9 * * *',
          credentialsEnv: {},
          notify: { title: 'Daily bill' },
        },
      ],
    };

    await startDaemon(app, {
      cron: {
        validate: () => true,
        schedule: (expression, _task, options) => {
          calls.push({ expression, options });
          return {} as never;
        },
      },
      keepAlive: async () => {},
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.expression, '0 9 * * *');
    assert.deepEqual(calls[0]?.options, { timezone: 'Asia/Kolkata' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -w @billing-agent/worker
```

Expected: FAIL — `schedules enabled jobs with Asia/Kolkata timezone` because `options` is `undefined` (third argument not passed yet). The existing skip test should still pass.

- [ ] **Step 3: Write minimal implementation**

In `apps/worker/src/scheduler.ts`:

1. Update `CronScheduler` to accept optional schedule options:

```ts
type CronScheduleOptions = {
  timezone: string;
};

type CronScheduler = {
  validate(expression: string): boolean;
  schedule(
    expression: string,
    task: () => void,
    options?: CronScheduleOptions,
  ): {
    stop?: () => void;
    destroy?: () => void;
  };
};
```

2. Change the `cron.schedule` call to pass timezone:

```ts
const task = schedulerDeps.cron.schedule(
  job.schedule,
  () => {
    void schedulerDeps
      .runJobs(activeApp, [job.id], schedulerDeps.store ? { store: schedulerDeps.store } : {})
      .catch((error: unknown) => {
        schedulerDeps.logger.error('scheduled job failed', {
          jobId: job.id,
          error: String(error),
        });
      });
  },
  { timezone: 'Asia/Kolkata' },
);
```

3. Extend the `scheduled job` log:

```ts
schedulerDeps.logger.info('scheduled job', {
  jobId: job.id,
  schedule: job.schedule,
  timezone: 'Asia/Kolkata',
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test -w @billing-agent/worker
```

Expected: PASS — both `startDaemon` tests green.

- [ ] **Step 5: Commit (only if user asked)**

If the user requested a commit:

```bash
git add apps/worker/src/scheduler.ts apps/worker/tests/scheduler.test.ts
git commit -m "$(cat <<'EOF'
fix(worker): evaluate cron schedules in Asia/Kolkata

EOF
)"
```

Otherwise skip this step and leave changes uncommitted.
