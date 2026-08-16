import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrateGenericJobs } from '../src/migrate-generic-jobs.ts';
import { decryptSecret, parseMasterKey } from '../src/secrets.ts';
import type {
  BillingStore,
  JobDocument,
  OverlayDocument,
  OverlaySuccessInput,
  PriceCheckDocument,
  RunDocument,
  SecretDocument,
  SettingsDocument,
  UserDocument,
  WatchDocument,
} from '../src/store/types.ts';

const TEST_MASTER_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function defaultSettings(): SettingsDocument {
  return {
    id: 'default',
    ntfy: {
      baseUrl: 'https://ntfy.sh',
      topicEnv: 'NTFY_TOPIC',
      priority: 'default',
    },
    mistral: {
      apiKeyEnv: 'MISTRAL_API_KEY',
      model: 'mistral-small-latest',
    },
    browser: {
      headless: true,
      timeoutMs: 60_000,
      saveErrorScreenshot: true,
    },
    jobsGeneration: 0,
    watchesGeneration: 0,
  };
}

/**
 * Dumb in-memory `BillingStore`. Unlike `createBillingStoreFromCollections`
 * (packages/core/src/store/mongo.ts), this does **not** coerce legacy job/run
 * shapes on read — it returns exactly what was stored, so tests can seed raw
 * pre-migration documents (`provider` / `credentialsEnv`, no `engine`) and
 * assert on what `migrateGenericJobs` actually persists.
 */
class FakeBillingStore implements BillingStore {
  jobs: Record<string, unknown>[] = [];
  secrets: SecretDocument[] = [];
  watches: WatchDocument[] = [];
  priceChecks: PriceCheckDocument[] = [];
  runs: RunDocument[] = [];
  settings: SettingsDocument;
  deletedWatchIds: string[] = [];
  deletedPriceCheckWatchIds: string[] = [];

  constructor(settings: SettingsDocument = defaultSettings()) {
    this.settings = settings;
  }

  async getSettings(): Promise<SettingsDocument> {
    return this.settings;
  }

  async listJobs(options?: { userId?: string }): Promise<JobDocument[]> {
    const jobs = options?.userId
      ? this.jobs.filter((job) => job.userId === options.userId)
      : this.jobs;
    return jobs as unknown as JobDocument[];
  }

  async getJob(id: string): Promise<JobDocument | null> {
    const found = this.jobs.find((job) => job.id === id);
    return (found ?? null) as unknown as JobDocument | null;
  }

  async upsertJob(job: JobDocument): Promise<void> {
    const index = this.jobs.findIndex((existing) => existing.id === job.id);
    if (index >= 0) {
      this.jobs[index] = job as unknown as Record<string, unknown>;
    } else {
      this.jobs.push(job as unknown as Record<string, unknown>);
    }
  }

  async upsertSettings(settings: Omit<SettingsDocument, 'id'>): Promise<void> {
    this.settings = { id: 'default', ...settings };
  }

  async upsertSecret(secret: SecretDocument): Promise<void> {
    const index = this.secrets.findIndex((existing) => existing.id === secret.id);
    if (index >= 0) {
      this.secrets[index] = secret;
    } else {
      this.secrets.push(secret);
    }
  }

  async listSecrets(options: {
    userId: string;
    jobId?: string;
    conversationId?: string;
  }): Promise<SecretDocument[]> {
    return this.secrets.filter(
      (secret) =>
        secret.userId === options.userId &&
        (options.jobId === undefined || secret.jobId === options.jobId) &&
        (options.conversationId === undefined ||
          secret.conversationId === options.conversationId),
    );
  }

  async deleteSecretsForJob(jobId: string): Promise<void> {
    this.secrets = this.secrets.filter((secret) => secret.jobId !== jobId);
  }

  async listWatches(options?: { userId?: string }): Promise<WatchDocument[]> {
    return options?.userId
      ? this.watches.filter((watch) => watch.userId === options.userId)
      : this.watches;
  }

  async getWatch(id: string): Promise<WatchDocument | null> {
    return this.watches.find((watch) => watch.id === id) ?? null;
  }

  async upsertWatch(watch: WatchDocument): Promise<void> {
    const index = this.watches.findIndex((existing) => existing.id === watch.id);
    if (index >= 0) {
      this.watches[index] = watch;
    } else {
      this.watches.push(watch);
    }
  }

  async deleteWatch(id: string): Promise<void> {
    this.deletedWatchIds.push(id);
    this.deletedPriceCheckWatchIds.push(id);
    this.watches = this.watches.filter((watch) => watch.id !== id);
    this.priceChecks = this.priceChecks.filter((check) => check.watchId !== id);
  }

  async createPriceCheck(check: PriceCheckDocument): Promise<void> {
    this.priceChecks.push(check);
  }

  async finishPriceCheck(
    id: string,
    update: Partial<PriceCheckDocument>,
  ): Promise<void> {
    const check = this.priceChecks.find((existing) => existing.id === id);
    if (check) Object.assign(check, update);
  }

  async listPriceChecks(options: {
    watchId: string;
    userId?: string;
    limit?: number;
  }): Promise<PriceCheckDocument[]> {
    return this.priceChecks.filter(
      (check) =>
        check.watchId === options.watchId &&
        (options.userId === undefined || check.userId === options.userId),
    );
  }

  async listActiveOverlays(): Promise<OverlayDocument[]> {
    return [];
  }

  async recordOverlaySuccess(input: OverlaySuccessInput): Promise<OverlayDocument> {
    throw new Error(`not used in migration tests: ${JSON.stringify(input)}`);
  }

  async createRun(run: RunDocument): Promise<void> {
    this.runs.push(run);
  }

  async finishRun(id: string, update: Partial<RunDocument>): Promise<void> {
    const run = this.runs.find((existing) => existing.id === id);
    if (run) Object.assign(run, update);
  }

  async listRuns(options?: {
    userId?: string;
    jobId?: string;
    limit?: number;
  }): Promise<RunDocument[]> {
    return this.runs.filter(
      (run) =>
        (options?.userId === undefined || run.userId === options.userId) &&
        (options?.jobId === undefined || run.jobId === options.jobId),
    );
  }

  async getRun(id: string): Promise<RunDocument | null> {
    return this.runs.find((run) => run.id === id) ?? null;
  }

  async findUserByEmail(): Promise<UserDocument | null> {
    return null;
  }

  async getUser(): Promise<UserDocument | null> {
    return null;
  }

  async close(): Promise<void> {}
}

function legacyTnpdclJob(): Record<string, unknown> {
  return {
    id: 'home-eb',
    userId: 'user-1',
    provider: 'tnpdcl',
    enabled: true,
    schedule: '0 9 * * *',
    credentialsEnv: {
      username: 'TNPDCL_USERNAME',
      password: 'TNPDCL_PASSWORD',
    },
    notify: { title: 'TNPDCL Bill' },
  };
}

function legacyDummyJob(): Record<string, unknown> {
  return {
    id: 'smoke-test',
    userId: 'user-1',
    provider: 'dummy',
    enabled: true,
    schedule: null,
    credentialsEnv: {},
    notify: { title: 'Dummy Bill' },
  };
}

function legacyWatch(): WatchDocument {
  return {
    id: 'craft-glory-old-skool-vb',
    userId: 'user-1',
    url: 'https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole',
    title: 'Old Skool Retro Leather Sneakers',
    enabled: true,
    schedule: '0 9 * * *',
    lastPrice: 2999,
    lastCurrency: 'INR',
    lastSource: 'shopify_json',
    lastCheckedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

function legacyPriceCheck(): PriceCheckDocument {
  return {
    id: 'check-1',
    watchId: 'craft-glory-old-skool-vb',
    userId: 'user-1',
    status: 'success',
    price: 2999,
    currency: 'INR',
    source: 'shopify_json',
    previousPrice: null,
    dropped: null,
    error: null,
    checkedAt: '2026-08-01T00:00:00.000Z',
  };
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    SECRETS_MASTER_KEY: TEST_MASTER_KEY_HEX,
    TNPDCL_USERNAME: 'alice',
    TNPDCL_PASSWORD: 'hunter2',
    NTFY_TOPIC: 'resolved-topic',
  };
}

const NOW = new Date('2026-08-16T00:00:00.000Z');

describe('migrateGenericJobs', () => {
  it('migrates a legacy tnpdcl adapter job, encrypting credentialsEnv into AES secrets', async () => {
    const store = new FakeBillingStore();
    store.jobs.push(legacyTnpdclJob());
    const env = baseEnv();

    const result = await migrateGenericJobs({ store, env, now: NOW });

    assert.equal(result.jobsMigrated, 1);

    const job = await store.getJob('home-eb');
    assert.ok(job);
    assert.equal(job.engine, 'adapter');
    assert.equal(job.adapterId, 'tnpdcl');
    assert.equal(job.name, 'TNPDCL Bill');
    assert.equal(job.startUrl, 'https://www.tnebnet.org/awp/login');
    assert.equal(job.goal, 'TNPDCL Bill');
    assert.deepEqual(
      job.schema.map((field) => field.key),
      ['amount', 'dueDate', 'billPeriod', 'status', 'accountLabel'],
    );
    assert.deepEqual(job.workflow, []);
    assert.equal(job.notify.on, 'always');
    assert.deepEqual(job.notify.channel, { type: 'ntfy', topic: 'resolved-topic' });
    assert.equal(job.enabled, true);
    assert.equal(job.schedule, '0 9 * * *');
    assert.equal(job.userId, 'user-1');
    assert.equal(job.secretIds.length, 2);

    const secrets = await store.listSecrets({ userId: 'user-1', jobId: 'home-eb' });
    assert.equal(secrets.length, 2);
    const key = parseMasterKey(env);
    const username = secrets.find((secret) => secret.key === 'username');
    const password = secrets.find((secret) => secret.key === 'password');
    assert.ok(username);
    assert.ok(password);
    assert.equal(decryptSecret(username, key), 'alice');
    assert.equal(decryptSecret(password, key), 'hunter2');
    assert.deepEqual(job.secretIds.slice().sort(), [username.id, password.id].sort());
  });

  it('migrates a legacy dummy adapter job with no credentials to encrypt', async () => {
    const store = new FakeBillingStore();
    store.jobs.push(legacyDummyJob());

    const result = await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    assert.equal(result.jobsMigrated, 1);
    const job = await store.getJob('smoke-test');
    assert.ok(job);
    assert.equal(job.engine, 'adapter');
    assert.equal(job.adapterId, 'dummy');
    assert.ok(job.startUrl.startsWith('file://'));
    assert.ok(job.startUrl.endsWith('fixtures/dummy-bill.html'));
    assert.deepEqual(job.secretIds, []);

    const secrets = await store.listSecrets({ userId: 'user-1', jobId: 'smoke-test' });
    assert.deepEqual(secrets, []);
  });

  it('stores no plaintext credentials or env-var names in the migrated job document', async () => {
    const store = new FakeBillingStore();
    store.jobs.push(legacyTnpdclJob());

    await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    const job = await store.getJob('home-eb');
    const serialized = JSON.stringify(job);
    assert.ok(!serialized.includes('alice'));
    assert.ok(!serialized.includes('hunter2'));
    assert.ok(!serialized.includes('TNPDCL_USERNAME'));
    assert.ok(!serialized.includes('TNPDCL_PASSWORD'));
    assert.ok(!serialized.includes('credentialsEnv'));
  });

  it('migrates a legacy watch into a deterministic workflow job', async () => {
    const store = new FakeBillingStore();
    store.watches.push(legacyWatch());

    const result = await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    assert.equal(result.watchesMigrated, 1);
    const job = await store.getJob('craft-glory-old-skool-vb');
    assert.ok(job);
    assert.equal(job.engine, 'workflow');
    assert.equal(job.adapterId, undefined);
    assert.equal(job.startUrl, legacyWatch().url);
    assert.equal(job.name, 'Old Skool Retro Leather Sneakers');
    assert.deepEqual(
      job.schema.map((field) => field.key),
      ['price', 'currency'],
    );
    assert.equal(job.notify.on, 'drop');
    assert.deepEqual(job.lastResult, { price: 2999, currency: 'INR' });
    assert.deepEqual(job.workflow, [
      { id: 'goto-watch', type: 'goto', url: legacyWatch().url },
      {
        id: 'extract-price',
        type: 'extract',
        fields: [
          { key: 'price', strategy: 'shopify_json' },
          { key: 'currency', strategy: 'shopify_json' },
          { key: 'price', strategy: 'price' },
        ],
      },
    ]);

    // Deterministic: migrating the same watch again produces the identical workflow shape.
    const store2 = new FakeBillingStore();
    store2.watches.push(legacyWatch());
    await migrateGenericJobs({ store: store2, env: baseEnv(), now: NOW });
    const job2 = await store2.getJob('craft-glory-old-skool-vb');
    assert.deepEqual(job2?.workflow, job?.workflow);
  });

  it('derives a job name from hostname when a watch has no title', async () => {
    const store = new FakeBillingStore();
    const watch = { ...legacyWatch(), title: null };
    store.watches.push(watch);

    await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    const job = await store.getJob(watch.id);
    assert.equal(job?.name, 'craftandglory.in');
  });

  it('copies a price_check into a generic run', async () => {
    const store = new FakeBillingStore();
    store.watches.push(legacyWatch());
    store.priceChecks.push(legacyPriceCheck());

    const result = await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    assert.equal(result.runsMigrated, 1);
    const run = await store.getRun('check-1');
    assert.ok(run);
    assert.equal(run.jobId, 'craft-glory-old-skool-vb');
    assert.equal(run.userId, 'user-1');
    assert.equal(run.engine, 'workflow');
    assert.equal(run.status, 'success');
    assert.equal(run.startedAt, '2026-08-01T00:00:00.000Z');
    assert.equal(run.finishedAt, '2026-08-01T00:00:00.000Z');
    assert.equal(run.recoveryAttempted, false);
    assert.equal(run.recoverySucceeded, false);
    assert.equal(run.overlayActivated, false);
    assert.deepEqual(run.result, { price: 2999, currency: 'INR' });
  });

  it('copies a failed price_check into a failed run with an error', async () => {
    const store = new FakeBillingStore();
    store.watches.push(legacyWatch());
    store.priceChecks.push({
      ...legacyPriceCheck(),
      id: 'check-2',
      status: 'failed',
      price: null,
      currency: null,
      error: 'ScrapeError: could not find price',
    });

    await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    const run = await store.getRun('check-2');
    assert.ok(run);
    assert.equal(run.status, 'failed');
    assert.equal(run.result, null);
    assert.equal(run.errorCode, 'ScrapeError');
    assert.equal(run.errorMessage, 'ScrapeError: could not find price');
  });

  it('skips a job that is already migrated (has engine set)', async () => {
    const store = new FakeBillingStore();
    const alreadyMigrated: JobDocument = {
      id: 'already-done',
      userId: 'user-1',
      name: 'Already Done',
      enabled: true,
      schedule: null,
      startUrl: 'https://www.tnebnet.org/awp/login',
      engine: 'adapter',
      adapterId: 'tnpdcl',
      goal: 'Already Done',
      schema: [],
      workflow: [],
      secretIds: [],
      notify: {
        title: 'Already Done',
        on: 'always',
        channel: { type: 'ntfy', topic: 'existing-topic' },
      },
      lastResult: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    store.jobs.push(alreadyMigrated as unknown as Record<string, unknown>);

    const result = await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    assert.equal(result.jobsMigrated, 0);
    const job = await store.getJob('already-done');
    assert.deepEqual(job, alreadyMigrated);
  });

  it('is idempotent across repeated runs: no duplicate jobs, secrets, or runs', async () => {
    const store = new FakeBillingStore();
    store.jobs.push(legacyTnpdclJob());
    store.watches.push(legacyWatch());
    store.priceChecks.push(legacyPriceCheck());
    const env = baseEnv();

    const first = await migrateGenericJobs({ store, env, now: NOW });
    assert.deepEqual(first, { jobsMigrated: 1, watchesMigrated: 1, runsMigrated: 1 });

    const second = await migrateGenericJobs({
      store,
      env,
      now: new Date('2026-08-17T00:00:00.000Z'),
    });
    assert.deepEqual(second, { jobsMigrated: 0, watchesMigrated: 0, runsMigrated: 0 });

    assert.equal(store.jobs.length, 2);
    assert.equal(store.runs.length, 1);
    const secrets = await store.listSecrets({ userId: 'user-1', jobId: 'home-eb' });
    assert.equal(secrets.length, 2);
  });

  it('maps settings: keeps ntfy baseUrl/priority + jobsGeneration, drops topicEnv and watchesGeneration', async () => {
    const store = new FakeBillingStore({
      id: 'default',
      ntfy: { baseUrl: 'https://ntfy.example', topicEnv: 'NTFY_TOPIC', priority: 'high' },
      mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
      browser: { headless: true, timeoutMs: 30_000, saveErrorScreenshot: false },
      jobsGeneration: 3,
      watchesGeneration: 7,
    });

    await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    const settings = await store.getSettings();
    assert.equal(settings.ntfy.baseUrl, 'https://ntfy.example');
    assert.equal(settings.ntfy.priority, 'high');
    assert.equal(settings.ntfy.defaultTopic, 'resolved-topic');
    assert.equal(settings.ntfy.topicEnv, undefined);
    assert.equal(settings.jobsGeneration, 3);
    assert.equal(settings.watchesGeneration, undefined);
    assert.deepEqual(settings.mistral, {
      apiKeyEnv: 'MISTRAL_API_KEY',
      model: 'mistral-small-latest',
    });
    assert.deepEqual(settings.browser, {
      headless: true,
      timeoutMs: 30_000,
      saveErrorScreenshot: false,
    });
  });

  it('does not delete watch or price_check collections in Slice 1', async () => {
    const store = new FakeBillingStore();
    store.watches.push(legacyWatch());
    store.priceChecks.push(legacyPriceCheck());

    await migrateGenericJobs({ store, env: baseEnv(), now: NOW });

    assert.equal(store.watches.length, 1);
    assert.equal(store.priceChecks.length, 1);
    assert.deepEqual(store.deletedWatchIds, []);
    assert.ok(await store.getWatch('craft-glory-old-skool-vb'));
    assert.equal(
      (await store.listPriceChecks({ watchId: 'craft-glory-old-skool-vb' })).length,
      1,
    );
  });
});
