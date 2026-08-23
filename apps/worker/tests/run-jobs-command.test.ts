import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppConfig, BillingStore, RunnerDeps } from '@billing-agent/core';
import { executeRunJobsCommand } from '../src/run-jobs-command.ts';

const app: AppConfig = {
  configPath: 'mongodb://runtime',
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

describe('executeRunJobsCommand', () => {
  it('passes the connected BillingStore into runJobs so adapter jobs can resolve Mongo secrets', async () => {
    let closed = false;
    const fakeStore = { close: async () => { closed = true; } } as unknown as BillingStore;
    const connectCalls: string[] = [];
    const runJobsCalls: Array<{
      app: AppConfig;
      jobIds: 'all' | string[];
      deps: Partial<RunnerDeps>;
    }> = [];

    const result = await executeRunJobsCommand('mongodb://test-uri', 'all', {
      connectStore: async (uri) => {
        connectCalls.push(uri);
        return fakeStore;
      },
      loadConfigFromStore: async (store) => {
        assert.equal(store, fakeStore);
        return app;
      },
      runJobs: async (runApp, jobIds, deps = {}) => {
        runJobsCalls.push({ app: runApp, jobIds, deps });
        return { failed: 0 };
      },
    });

    assert.deepEqual(connectCalls, ['mongodb://test-uri']);
    assert.equal(runJobsCalls.length, 1);
    // The bug: runJobs was previously called with no deps at all, so
    // job-runner's `runnerDeps.store` stayed undefined and
    // `resolveJobSecrets` was skipped for every job, silently resolving
    // empty credentials for adapter jobs whose secrets live in Mongo.
    assert.equal(runJobsCalls[0]?.deps.store, fakeStore);
    assert.deepEqual(result, { failed: 0 });
    assert.equal(closed, true);
  });

  it('closes the store even when runJobs throws', async () => {
    let closed = false;
    const fakeStore = { close: async () => { closed = true; } } as unknown as BillingStore;

    await assert.rejects(
      executeRunJobsCommand('mongodb://test-uri', ['missing-job'], {
        connectStore: async () => fakeStore,
        loadConfigFromStore: async () => app,
        runJobs: async () => {
          throw new Error('boom');
        },
      }),
      /boom/,
    );

    assert.equal(closed, true);
  });
});
