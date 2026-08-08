import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import type { BillingAdapter, BillResult } from '../src/adapters/types.ts';
import type { AppConfig, JobConfig } from '../src/config.ts';
import { ConfigError, LoginError } from '../src/errors.ts';
import { runJob, runJobs } from '../src/job-runner.ts';

const job: JobConfig = {
  id: 'fake-job',
  provider: 'fake',
  enabled: true,
  schedule: null,
  credentialsEnv: { username: 'FAKE_JOB_USERNAME' },
  notify: { title: 'Fake bill' },
};

const app: AppConfig = {
  configPath: '/tmp/jobs.json',
  ntfy: {
    baseUrl: 'https://ntfy.example',
    topic: 'billing',
    priority: 'urgent',
  },
  mistral: { apiKeyEnv: 'FAKE_MISTRAL_API_KEY', model: 'test-model' },
  browser: {
    headless: true,
    timeoutMs: 1_000,
    saveErrorScreenshot: false,
  },
  jobs: [job],
};

const testEnv = { FAKE_JOB_USERNAME: 'test-user' };

const billResult: BillResult = {
  provider: 'fake',
  amount: '₹123.45',
  dueDate: '2026-08-20',
  accountLabel: '****1234',
};

describe('runJob', () => {
  it('resolves job credentials and sends a success notification with the configured priority', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const adapter: BillingAdapter = {
      id: 'fake',
      async run(context) {
        assert.deepEqual(context.credentials, { username: 'test-user' });
        assert.equal(context.timeoutMs, app.browser.timeoutMs);
        return billResult;
      },
    };

    const result = await runJob(app, job, {
      withBrowser: async (_config, callback) =>
        callback({} as Page),
      sendNtfy: async (options) => {
        notifications.push(options);
      },
      createMistralCaptchaSolver: () => ({
        solveFromImageBase64: async () => 'captcha',
      }),
      getAdapter: () => adapter,
      env: testEnv,
    });

    assert.deepEqual(result, { ok: true, result: billResult });
    assert.deepEqual(notifications, [
      {
        baseUrl: app.ntfy.baseUrl,
        topic: app.ntfy.topic,
        title: job.notify.title,
        body:
          'Amount: ₹123.45\nDue: 2026-08-20\nAccount: ****1234',
        priority: app.ntfy.priority,
      },
    ]);
  });

  it('skips success notification when result.notify is false', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const quietResult: BillResult = {
      provider: 'fake',
      amount: '₹0',
      status: 'no pending bills',
      accountLabel: '****1234',
      notify: false,
    };
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        return quietResult;
      },
    };

    const result = await runJob(app, job, {
      withBrowser: async (_config, callback) => callback({} as Page),
      sendNtfy: async (options) => {
        notifications.push(options);
      },
      createMistralCaptchaSolver: () => ({
        solveFromImageBase64: async () => 'captcha',
      }),
      getAdapter: () => adapter,
      env: testEnv,
    });

    assert.deepEqual(result, { ok: true, result: quietResult });
    assert.deepEqual(notifications, []);
  });

  it('never resolves the Mistral API key for adapters that never solve a captcha', async () => {
    let solverFactoryCalls = 0;
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        return billResult;
      },
    };

    const result = await runJob(app, job, {
      withBrowser: async (_config, callback) => callback({} as Page),
      sendNtfy: async () => {},
      createMistralCaptchaSolver: () => {
        solverFactoryCalls += 1;
        return { solveFromImageBase64: async () => 'captcha' };
      },
      getAdapter: () => adapter,
      env: testEnv,
    });

    assert.deepEqual(result, { ok: true, result: billResult });
    assert.equal(solverFactoryCalls, 0);
  });

  it('returns a login error and sends a high-priority failure notification', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const loginError = new LoginError('credentials rejected');
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        throw loginError;
      },
    };

    const result = await runJob(app, job, {
      withBrowser: async (_config, callback) =>
        callback({} as Page),
      sendNtfy: async (options) => {
        notifications.push(options);
      },
      createMistralCaptchaSolver: () => ({
        solveFromImageBase64: async () => 'captcha',
      }),
      getAdapter: () => adapter,
      env: testEnv,
    });

    assert.deepEqual(result, { ok: false, error: loginError });
    assert.deepEqual(notifications, [
      {
        baseUrl: app.ntfy.baseUrl,
        topic: app.ntfy.topic,
        title: 'Billing agent failed: fake-job',
        body:
          'Job: fake-job\nError: LoginError\ncredentials rejected',
        priority: 'high',
      },
    ]);
  });

  it('creates tmp before capturing and reports an error screenshot', async () => {
    let screenshotPath: string | undefined;
    let notificationBody = '';
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        throw new LoginError('login failed');
      },
    };
    const page = {
      screenshot: async (options: { path: string }) => {
        assert.equal(existsSync(dirname(options.path)), true);
        screenshotPath = options.path;
        return Buffer.alloc(0);
      },
    } as unknown as Page;

    const result = await runJob(
      {
        ...app,
        browser: { ...app.browser, saveErrorScreenshot: true },
      },
      job,
      {
        withBrowser: async (_config, callback) => callback(page),
        sendNtfy: async (options) => {
          notificationBody = options.body;
        },
        createMistralCaptchaSolver: () => ({
          solveFromImageBase64: async () => 'captcha',
        }),
        getAdapter: () => adapter,
        env: testEnv,
      },
    );

    assert.equal(result.ok, false);
    assert.match(
      screenshotPath ?? '',
      /^tmp\/fake-job-\d+\.png$/,
    );
    assert.match(
      notificationBody,
      /Screenshot: tmp\/fake-job-\d+\.png$/,
    );
  });

  it('sanitizes the job id used in error screenshot paths', async () => {
    let screenshotPath: string | undefined;
    const unsafeJob = { ...job, id: '../nested/evil?' };
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        throw new LoginError('login failed');
      },
    };
    const page = {
      screenshot: async (options: { path: string }) => {
        screenshotPath = options.path;
        return Buffer.alloc(0);
      },
    } as unknown as Page;

    await runJob(
      {
        ...app,
        browser: { ...app.browser, saveErrorScreenshot: true },
      },
      unsafeJob,
      {
        withBrowser: async (_config, callback) => callback(page),
        sendNtfy: async () => {},
        createMistralCaptchaSolver: () => ({
          solveFromImageBase64: async () => 'captcha',
        }),
        getAdapter: () => adapter,
        env: testEnv,
      },
    );

    assert.match(
      screenshotPath ?? '',
      /^tmp\/___nested_evil_-\d+\.png$/,
    );
  });

  it('returns the job error when the failure notification also fails', async () => {
    const loginError = new LoginError('login failed');
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        throw loginError;
      },
    };

    const result = await runJob(app, job, {
      withBrowser: async (_config, callback) =>
        callback({} as Page),
      sendNtfy: async () => {
        throw new Error('ntfy unavailable');
      },
      createMistralCaptchaSolver: () => ({
        solveFromImageBase64: async () => 'captcha',
      }),
      getAdapter: () => adapter,
      env: testEnv,
    });

    assert.deepEqual(result, { ok: false, error: loginError });
  });
});

describe('runJobs', () => {
  it('throws a config error for an unknown requested job id', async () => {
    await assert.rejects(
      runJobs(app, ['missing-job']),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.message === 'Unknown job id: missing-job',
    );
  });

  it('runs all enabled jobs and continues after failures', async () => {
    const attempted: string[] = [];
    const jobs: JobConfig[] = [
      {
        ...job,
        id: 'fails',
        credentialsEnv: { marker: 'FAILS_MARKER' },
      },
      {
        ...job,
        id: 'succeeds',
        credentialsEnv: { marker: 'SUCCEEDS_MARKER' },
      },
      {
        ...job,
        id: 'disabled',
        enabled: false,
        credentialsEnv: { marker: 'DISABLED_MARKER' },
      },
    ];
    const adapter: BillingAdapter = {
      id: 'fake',
      async run(context) {
        const marker = context.credentials.marker;
        attempted.push(marker);
        if (marker === 'fails') throw new LoginError('login failed');
        return billResult;
      },
    };

    const result = await runJobs(
      { ...app, jobs },
      'all',
      {
        withBrowser: async (_config, callback) =>
          callback({} as Page),
        sendNtfy: async () => {},
        createMistralCaptchaSolver: () => ({
          solveFromImageBase64: async () => 'captcha',
        }),
        getAdapter: () => adapter,
        env: {
          FAILS_MARKER: 'fails',
          SUCCEEDS_MARKER: 'succeeds',
          DISABLED_MARKER: 'disabled',
        },
      },
    );

    assert.deepEqual(attempted, ['fails', 'succeeds']);
    assert.deepEqual(result, { failed: 1 });
  });
});
