import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppConfig, SettingsDocument } from '@billing-agent/core';
import { createBrowserLock } from '@billing-agent/core';
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

  it('reloads job tasks when jobsGeneration changes', async () => {
    const app: AppConfig = {
      ...baseApp,
      jobs: [
        {
          id: 'job-1',
          provider: 'dummy',
          enabled: true,
          schedule: '1 9 * * *',
          credentialsEnv: {},
          notify: { title: 'Daily bill' },
        },
      ],
    };
    const calls: string[] = [];
    const stopCalls: string[] = [];
    let intervalCallback: (() => void) | undefined;
    let settingsReads = 0;

    const store = {
      async getSettings() {
        settingsReads += 1;
        return {
          id: 'default',
          ntfy: { baseUrl: 'https://ntfy.sh', topicEnv: 'NTFY_TOPIC', priority: 'default' },
          mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
          browser: { headless: true, timeoutMs: 1_000, saveErrorScreenshot: false },
          jobsGeneration: settingsReads >= 1 ? 1 : 0,
        } as SettingsDocument;
      },
    } as unknown as Parameters<typeof startDaemon>[1] extends { store?: infer T } ? T : never;

    await startDaemon(app, {
      store,
      cron: {
        validate: () => true,
        schedule: (expression) => {
          calls.push(expression);
          return {
            stop: () => stopCalls.push(expression),
          };
        },
      },
      loadConfigFromStore: async () => ({
        ...app,
        jobsGeneration: 1,
      }),
      setIntervalFn: (cb) => {
        intervalCallback = cb;
        return 1 as unknown as NodeJS.Timeout;
      },
      clearIntervalFn: () => {},
      keepAlive: async () => {
        intervalCallback?.();
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    assert.deepEqual(calls, ['1 9 * * *', '1 9 * * *']);
    assert.deepEqual(stopCalls, ['1 9 * * *', '1 9 * * *']);
  });
});

describe('startDaemon — browser lock', () => {
  const scheduledJobApp: AppConfig = {
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
  } as AppConfig;

  /** Registers the cron tasks, then fires the one job tick the app schedules. */
  async function fireJobTick(
    deps: Parameters<typeof startDaemon>[1],
  ): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];
    let tick: (() => void) | undefined;

    await startDaemon(scheduledJobApp, {
      cron: {
        validate: () => true,
        schedule: (_expression, task) => {
          tick = task;
          return {};
        },
      },
      keepAlive: async () => {
        tick?.();
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      logger: {
        info: () => {},
        warn: (message) => warnings.push(message),
        error: () => {},
      },
      ...deps,
    });

    return { warnings };
  }

  it('skips the tick while the browser lock is held', async () => {
    const lock = createBrowserLock();
    lock.tryAcquire({ kind: 'authoring', id: 'conversation-1' });
    const runJobsCalls: unknown[] = [];

    const { warnings } = await fireJobTick({
      lock,
      runJobs: async (...args: unknown[]) => {
        runJobsCalls.push(args);
        return { failed: 0 };
      },
    } as unknown as Parameters<typeof startDaemon>[1]);

    assert.deepEqual(runJobsCalls, []);
    assert.equal(
      warnings.some((message) => /browser is busy/i.test(message)),
      true,
    );
    assert.deepEqual(lock.current(), { kind: 'authoring', id: 'conversation-1' });
  });

  it('runs the tick and hands the lock to the runner when nothing holds it', async () => {
    const lock = createBrowserLock();
    const runJobsDeps: Array<Record<string, unknown>> = [];

    await fireJobTick({
      lock,
      runJobs: async (_app: unknown, _ids: unknown, deps: Record<string, unknown>) => {
        runJobsDeps.push(deps);
        return { failed: 0 };
      },
    } as unknown as Parameters<typeof startDaemon>[1]);

    assert.equal(runJobsDeps.length, 1);
    assert.equal(runJobsDeps[0]?.lock, lock);
  });

  it('runs the tick unchanged when no lock is configured', async () => {
    const runJobsCalls: unknown[] = [];

    await fireJobTick({
      runJobs: async (...args: unknown[]) => {
        runJobsCalls.push(args);
        return { failed: 0 };
      },
    } as unknown as Parameters<typeof startDaemon>[1]);

    assert.equal(runJobsCalls.length, 1);
  });
});
