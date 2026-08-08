import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import type { BillingAdapter, BillResult } from '../src/adapters/types.ts';
import type { AppConfig, JobConfig } from '../src/config.ts';
import { LoginError } from '../src/errors.ts';
import { runJob, runJobs } from '../src/job-runner.ts';

const job: JobConfig = {
  id: 'fake-job',
  provider: 'fake',
  enabled: true,
  schedule: null,
  credentials: { username: 'test-user' },
  notify: { title: 'Fake bill' },
};

const app: AppConfig = {
  configPath: '/tmp/jobs.json',
  ntfy: {
    baseUrl: 'https://ntfy.example',
    topic: 'billing',
    priority: 'urgent',
  },
  mistral: { apiKey: 'test-key', model: 'test-model' },
  browser: {
    headless: true,
    timeoutMs: 1_000,
    saveErrorScreenshot: false,
  },
  jobs: [job],
};

const billResult: BillResult = {
  provider: 'fake',
  amount: '₹123.45',
  dueDate: '2026-08-20',
  accountLabel: '****1234',
};

describe('runJob', () => {
  it('runs an adapter and sends a default-priority success notification', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const adapter: BillingAdapter = {
      id: 'fake',
      async run(context) {
        assert.equal(context.credentials, job.credentials);
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
    });

    assert.deepEqual(result, { ok: true, result: billResult });
    assert.deepEqual(notifications, [
      {
        baseUrl: app.ntfy.baseUrl,
        topic: app.ntfy.topic,
        title: job.notify.title,
        body:
          'Amount: ₹123.45\nDue: 2026-08-20\nAccount: ****1234',
        priority: 'default',
      },
    ]);
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
    });

    assert.deepEqual(result, { ok: false, error: loginError });
  });
});

describe('runJobs', () => {
  it('runs all enabled jobs and continues after failures', async () => {
    const attempted: string[] = [];
    const jobs: JobConfig[] = [
      {
        ...job,
        id: 'fails',
        credentials: { marker: 'fails' },
      },
      {
        ...job,
        id: 'succeeds',
        credentials: { marker: 'succeeds' },
      },
      {
        ...job,
        id: 'disabled',
        enabled: false,
        credentials: { marker: 'disabled' },
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
      },
    );

    assert.deepEqual(attempted, ['fails', 'succeeds']);
    assert.deepEqual(result, { failed: 1 });
  });
});
