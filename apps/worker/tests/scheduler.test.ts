import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppConfig, SettingsDocument, WatchDocument } from '@billing-agent/core';
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

function makeWatch(overrides: Partial<WatchDocument> = {}): WatchDocument {
  return {
    id: 'watch-1',
    userId: 'user-1',
    url: 'https://example.com/product',
    title: 'Demo Product',
    enabled: true,
    schedule: '0 9 * * *',
    lastPrice: null,
    lastCurrency: null,
    lastSource: null,
    lastCheckedAt: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

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

  it('reloads only watch tasks when watchesGeneration changes', async () => {
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
    const settings: SettingsDocument = {
      id: 'default',
      ntfy: { baseUrl: 'https://ntfy.sh', topicEnv: 'NTFY_TOPIC', priority: 'default' },
      mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
      browser: { headless: true, timeoutMs: 1_000, saveErrorScreenshot: false },
      jobsGeneration: 0,
      watchesGeneration: 0,
    };

    const store = {
      async getSettings() {
        settingsReads += 1;
        if (settingsReads > 1) {
          return { ...settings, watchesGeneration: 1 };
        }
        return settings;
      },
      async listWatches() {
        return [makeWatch({ schedule: '2 9 * * *' })];
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
      loadConfigFromStore: async () => {
        throw new Error('jobs should not reload when only watchesGeneration changes');
      },
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

    assert.deepEqual(calls, ['2 9 * * *', '1 9 * * *', '2 9 * * *']);
    assert.deepEqual(stopCalls, ['2 9 * * *', '1 9 * * *', '2 9 * * *']);
  });

  it('reloads only job tasks when jobsGeneration changes', async () => {
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
          jobsGeneration: settingsReads > 1 ? 1 : 0,
          watchesGeneration: 0,
        } as SettingsDocument;
      },
      async listWatches() {
        return [makeWatch({ schedule: '2 9 * * *' })];
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

    assert.deepEqual(calls, ['2 9 * * *', '1 9 * * *', '1 9 * * *']);
    assert.deepEqual(stopCalls, ['1 9 * * *', '1 9 * * *', '2 9 * * *']);
  });
});
