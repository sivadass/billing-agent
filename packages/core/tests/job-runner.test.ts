import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import type { BillingAdapter, BillResult } from '../src/adapters/types.ts';
import type { AppConfig, JobConfig } from '../src/config.ts';
import { ConfigError, LoginError } from '../src/errors.ts';
import { encryptSecret } from '../src/secrets.ts';
import type { BillingStore, RunDocument, SecretDocument } from '../src/store/types.ts';
import { billResultToRecord, runJob, runJobs } from '../src/job-runner.ts';

const TEST_MASTER_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_MASTER_KEY = Buffer.from(TEST_MASTER_KEY_HEX, 'hex');

const billSchema: JobConfig['schema'] = [
  { key: 'amount', label: 'Amount', type: 'price' },
  { key: 'dueDate', label: 'Due', type: 'date' },
  { key: 'billPeriod', label: 'Period', type: 'string' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'accountLabel', label: 'Account', type: 'string' },
];

const job: JobConfig = {
  id: 'fake-job',
  userId: 'user-1',
  name: 'Fake bill',
  enabled: true,
  schedule: null,
  startUrl: 'https://example.test/fake',
  engine: 'adapter',
  adapterId: 'fake',
  goal: '',
  schema: billSchema,
  workflow: [],
  secretIds: [],
  notify: {
    title: 'Fake bill',
    on: 'always',
    channel: { type: 'ntfy', topic: '' },
  },
  lastResult: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
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

function makeSecretDoc(overrides: Partial<SecretDocument> = {}): SecretDocument {
  return {
    id: 'secret-1',
    userId: 'user-1',
    jobId: 'fake-job',
    conversationId: null,
    key: 'username',
    ciphertext: '',
    iv: '',
    tag: '',
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  };
}

/** Minimal BillingStore stub: runs are discarded, secrets come from the given fixed list. */
function storeWithSecrets(secrets: SecretDocument[]): BillingStore {
  return {
    async createRun() {},
    async finishRun() {},
    async listActiveOverlays() {
      return [];
    },
    async listSecrets(options) {
      return secrets.filter(
        (secret) =>
          secret.userId === options.userId &&
          (options.jobId === undefined || secret.jobId === options.jobId),
      );
    },
  } as unknown as BillingStore;
}

describe('billResultToRecord', () => {
  it('maps required fields and never includes provider or notify', () => {
    const record = billResultToRecord({
      provider: 'fake',
      amount: '₹1',
      accountLabel: '****1',
      notify: false,
    });
    assert.deepEqual(record, { amount: '₹1', accountLabel: '****1' });
    assert.equal('provider' in record, false);
    assert.equal('notify' in record, false);
  });

  it('includes optional fields only when present', () => {
    const record = billResultToRecord({
      provider: 'fake',
      amount: '₹1',
      accountLabel: '****1',
      dueDate: '2026-08-20',
      billPeriod: 'Jul-Aug',
      status: 'unpaid',
      rawNotes: 'note',
    });
    assert.deepEqual(record, {
      amount: '₹1',
      accountLabel: '****1',
      dueDate: '2026-08-20',
      billPeriod: 'Jul-Aug',
      status: 'unpaid',
      rawNotes: 'note',
    });
  });

  it('omits optional fields when falsy/absent', () => {
    const record = billResultToRecord({
      provider: 'fake',
      amount: '₹1',
      accountLabel: '****1',
      dueDate: '',
    });
    assert.deepEqual(record, { amount: '₹1', accountLabel: '****1' });
  });
});

describe('runJob', () => {
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

  it('stamps the run with the job owner userId', async () => {
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
      proposeOverlayPatch: async () => {
        throw new ConfigError('unused');
      },
    });

    assert.equal(runs[0]?.userId, job.userId);
  });

  it('writes result.amount (generic result), never billSummary or provider, on adapter success', async () => {
    const runUpdates: Array<Partial<RunDocument>> = [];
    const store = {
      async createRun() {},
      async finishRun(_id: string, update: Partial<RunDocument>) {
        runUpdates.push(update);
      },
      async listActiveOverlays() {
        return [];
      },
      async listSecrets() {
        return [];
      },
    } as unknown as BillingStore;

    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        return billResult;
      },
    };

    const result = await runJob(app, job, {
      env: testEnv,
      store,
      getAdapter: () => adapter,
      withBrowser: async (_config, callback) => callback({} as Page),
      sendNtfy: async () => {},
    });

    assert.equal(result.ok, true);
    assert.deepEqual(runUpdates.at(-1)?.result, {
      amount: '₹123.45',
      dueDate: '2026-08-20',
      accountLabel: '****1234',
    });
    assert.equal((runUpdates.at(-1)?.result as Record<string, unknown>)?.provider, undefined);
    assert.equal((runUpdates.at(-1)?.result as Record<string, unknown>)?.billSummary, undefined);
    assert.equal('billSummary' in (runUpdates.at(-1) ?? {}), false);
  });

  it('attempts one recovery and records overlay success after retry succeeds', async () => {
    const calls: string[] = [];
    const runUpdates: Array<Partial<Record<string, unknown>>> = [];
    const store: BillingStore = {
      getSettings: async () => {
        throw new Error('not used');
      },
      listJobs: async () => {
        throw new Error('not used');
      },
      getJob: async () => null,
      upsertJob: async () => {},
      upsertSettings: async () => {},
      upsertSecret: async () => {},
      listSecrets: async () => [],
      deleteSecretsForJob: async () => {},
      listWatches: async () => [],
      getWatch: async () => null,
      upsertWatch: async () => {},
      deleteWatch: async () => {},
      createPriceCheck: async () => {},
      finishPriceCheck: async () => {},
      listPriceChecks: async () => [],
      listActiveOverlays: async () => [],
      recordOverlaySuccess: async (input) => ({
        provider: input.provider,
        jobId: input.jobId,
        fingerprint: input.fingerprint,
        patch: input.patch,
        successCount: 1,
        status: 'candidate',
        updatedAt: new Date().toISOString(),
      }),
      createRun: async () => {},
      finishRun: async (_id, update) => {
        runUpdates.push(update);
      },
      listRuns: async () => [],
      getRun: async () => null,
      close: async () => {},
    };

    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        calls.push('run');
        if (calls.length === 1) {
          throw new LoginError('login failed once');
        }
        return billResult;
      },
    };

    const result = await runJob(app, job, {
      withBrowser: async (_config, callback) =>
        callback({
          url: () => 'https://example.test/login',
          title: async () => 'Login',
          screenshot: async () => Buffer.alloc(0),
        } as unknown as Page),
      sendNtfy: async () => {},
      createMistralCaptchaSolver: () => ({
        solveFromImageBase64: async () => 'captcha',
      }),
      getAdapter: () => adapter,
      env: testEnv,
      store,
      extractCompactDom: async () => '<input id="userName" />',
      proposeOverlayPatch: async () => ({ username: '#userName' }),
    });

    assert.deepEqual(result, { ok: true, result: billResult });
    assert.equal(calls.length, 2);
    assert.equal(runUpdates.length > 0, true);
    assert.equal(runUpdates.at(-1)?.recoveryAttempted, true);
    assert.equal(runUpdates.at(-1)?.recoverySucceeded, true);
  });

  it('does not run recovery for ConfigError failures', async () => {
    let recoveryCalls = 0;
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        throw new ConfigError('bad settings');
      },
    };

    const result = await runJob(app, job, {
      withBrowser: async (_config, callback) => callback({} as Page),
      sendNtfy: async () => {},
      createMistralCaptchaSolver: () => ({
        solveFromImageBase64: async () => 'captcha',
      }),
      getAdapter: () => adapter,
      env: testEnv,
      proposeOverlayPatch: async () => {
        recoveryCalls += 1;
        return { username: '#userName' };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(recoveryCalls, 0);
  });

  it('resolves job secrets from the store and passes them as adapter credentials', async () => {
    const encrypted = encryptSecret('test-user', TEST_MASTER_KEY);
    const store = storeWithSecrets([
      makeSecretDoc({ id: 'secret-1', key: 'username', ...encrypted }),
    ]);
    const jobWithSecret: JobConfig = { ...job, secretIds: ['secret-1'] };

    const notifications: Array<Record<string, unknown>> = [];
    const adapter: BillingAdapter = {
      id: 'fake',
      async run(context) {
        assert.deepEqual(context.credentials, { username: 'test-user' });
        assert.equal(context.timeoutMs, app.browser.timeoutMs);
        return billResult;
      },
    };

    const result = await runJob(app, jobWithSecret, {
      withBrowser: async (_config, callback) => callback({} as Page),
      sendNtfy: async (options) => {
        notifications.push(options);
      },
      createMistralCaptchaSolver: () => ({
        solveFromImageBase64: async () => 'captcha',
      }),
      getAdapter: () => adapter,
      env: { ...testEnv, SECRETS_MASTER_KEY: TEST_MASTER_KEY_HEX },
      store,
    });

    assert.deepEqual(result, { ok: true, result: billResult });
    assert.deepEqual(notifications, [
      {
        baseUrl: app.ntfy.baseUrl,
        topic: app.ntfy.topic,
        title: job.notify.title,
        body: 'Amount: ₹123.45\nDue: 2026-08-20\nAccount: ****1234',
        priority: app.ntfy.priority,
      },
    ]);
  });

  it('never logs plaintext or ciphertext secret values', async () => {
    const plaintext = 'super-secret-plaintext-value';
    const encrypted = encryptSecret(plaintext, TEST_MASTER_KEY);
    const store = storeWithSecrets([
      makeSecretDoc({ id: 'secret-1', key: 'password', ...encrypted }),
    ]);
    const jobWithSecret: JobConfig = { ...job, secretIds: ['secret-1'] };

    const consoleLines: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => {
      consoleLines.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      consoleLines.push(args.map(String).join(' '));
    };

    try {
      const adapter: BillingAdapter = {
        id: 'fake',
        async run() {
          return billResult;
        },
      };

      await runJob(app, jobWithSecret, {
        withBrowser: async (_config, callback) => callback({} as Page),
        sendNtfy: async () => {},
        createMistralCaptchaSolver: () => ({
          solveFromImageBase64: async () => 'captcha',
        }),
        getAdapter: () => adapter,
        env: { ...testEnv, SECRETS_MASTER_KEY: TEST_MASTER_KEY_HEX },
        store,
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const joined = consoleLines.join('\n');
    assert.equal(joined.includes(plaintext), false);
    assert.equal(joined.includes(encrypted.ciphertext), false);
  });

  it('uses the job notify channel topic when non-empty, overriding the global default', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const customTopicJob: JobConfig = {
      ...job,
      notify: {
        ...job.notify,
        channel: { type: 'ntfy', topic: 'custom-topic', baseUrl: 'https://custom.ntfy' },
      },
    };
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        return billResult;
      },
    };

    await runJob(app, customTopicJob, {
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

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.topic, 'custom-topic');
    assert.equal(notifications[0]?.baseUrl, 'https://custom.ntfy');
  });

  it('falls back to the global ntfy topic/baseUrl when the job channel topic is empty', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        return billResult;
      },
    };

    await runJob(app, job, {
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

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.topic, app.ntfy.topic);
    assert.equal(notifications[0]?.baseUrl, app.ntfy.baseUrl);
  });

  it('skips success notify for webhook channels (not implemented until slice 2)', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const webhookJob: JobConfig = {
      ...job,
      notify: {
        ...job.notify,
        channel: { type: 'webhook', url: 'https://example.test/webhook' },
      },
    };
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        return billResult;
      },
    };

    const result = await runJob(app, webhookJob, {
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

    assert.equal(result.ok, true);
    assert.deepEqual(notifications, []);
  });

  it('skips failure notify for webhook channels (not implemented until slice 2)', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const webhookJob: JobConfig = {
      ...job,
      notify: {
        ...job.notify,
        channel: { type: 'webhook', url: 'https://example.test/webhook' },
      },
    };
    const loginError = new LoginError('credentials rejected');
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        throw loginError;
      },
    };

    const result = await runJob(app, webhookJob, {
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

    assert.deepEqual(result, { ok: false, error: loginError });
    assert.deepEqual(notifications, []);
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

  it('returns a login error and sends a high-priority failure notification titled "{notify.title} failed"', async () => {
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
        title: 'Fake bill failed',
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

  it('runs all enabled jobs and continues after failures, resolving per-job secrets', async () => {
    const attempted: string[] = [];
    const secretDocs: SecretDocument[] = [
      makeSecretDoc({
        id: 'secret-fails',
        jobId: 'fails',
        key: 'marker',
        ...encryptSecret('fails', TEST_MASTER_KEY),
      }),
      makeSecretDoc({
        id: 'secret-succeeds',
        jobId: 'succeeds',
        key: 'marker',
        ...encryptSecret('succeeds', TEST_MASTER_KEY),
      }),
      makeSecretDoc({
        id: 'secret-disabled',
        jobId: 'disabled',
        key: 'marker',
        ...encryptSecret('disabled', TEST_MASTER_KEY),
      }),
    ];
    const store = storeWithSecrets(secretDocs);
    const jobs: JobConfig[] = [
      { ...job, id: 'fails', secretIds: ['secret-fails'] },
      { ...job, id: 'succeeds', secretIds: ['secret-succeeds'] },
      { ...job, id: 'disabled', enabled: false, secretIds: ['secret-disabled'] },
    ];
    const adapter: BillingAdapter = {
      id: 'fake',
      async run(context) {
        const marker = context.credentials.marker;
        attempted.push(marker);
        // ConfigError (not LoginError) so the store-backed recovery path is
        // never engaged here; that path is covered separately above.
        if (marker === 'fails') throw new ConfigError('login failed');
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
        env: { SECRETS_MASTER_KEY: TEST_MASTER_KEY_HEX },
        store,
      },
    );

    assert.deepEqual(attempted, ['fails', 'succeeds']);
    assert.deepEqual(result, { failed: 1 });
  });
});
