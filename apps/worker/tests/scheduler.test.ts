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
