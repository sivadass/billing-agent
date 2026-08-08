import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppConfig } from '../src/config.ts';
import { startDaemon } from '../src/scheduler.ts';

const app: AppConfig = {
  configPath: '/tmp/jobs.json',
  ntfy: {
    baseUrl: 'https://ntfy.example',
    topic: 'billing',
    priority: 'default',
  },
  mistral: { apiKey: 'test-key', model: 'test-model' },
  browser: {
    headless: true,
    timeoutMs: 1_000,
    saveErrorScreenshot: false,
  },
  jobs: [
    {
      id: 'manual-only',
      provider: 'dummy',
      enabled: true,
      schedule: null,
      credentials: {},
      notify: { title: 'Manual bill' },
    },
  ],
};

describe('startDaemon', () => {
  it('skips jobs without a schedule', async () => {
    const scheduled: string[] = [];

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
});
