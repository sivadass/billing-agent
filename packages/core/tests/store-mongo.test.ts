import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBillingStoreFromCollections } from '../src/store/mongo.ts';
import type {
  JobDocument,
  OverlayDocument,
  PriceCheckDocument,
  RunDocument,
  SelectorOverlayPatch,
  SettingsDocument,
  UserDocument,
  WatchDocument,
} from '../src/store/types.ts';

type Query<T> = Partial<{ [K in keyof T]: T[K] }>;

class MemoryCollection<T extends Record<string, unknown>> {
  #rows: T[] = [];

  async findOne(query: Query<T>): Promise<T | null> {
    return this.#rows.find((row) => this.#matches(row, query)) ?? null;
  }

  find(query: Query<T> = {}) {
    const rows = this.#rows.filter((row) => this.#matches(row, query));
    return {
      toArray: async () => [...rows],
    };
  }

  async insertOne(doc: T): Promise<void> {
    this.#rows.push({ ...doc });
  }

  async updateOne(
    filter: Query<T>,
    update: {
      $set?: Partial<T>;
      $setOnInsert?: Partial<T>;
      $inc?: Record<string, number>;
    },
    options?: { upsert?: boolean },
  ): Promise<void> {
    const existing = this.#rows.find((row) => this.#matches(row, filter));
    if (!existing) {
      if (!options?.upsert) return;
      const created = {
        ...(update.$setOnInsert ?? {}),
        ...(update.$set ?? {}),
      } as T;
      if (update.$inc) {
        for (const [key, value] of Object.entries(update.$inc)) {
          (created as Record<string, unknown>)[key] = value;
        }
      }
      this.#rows.push(created);
      return;
    }
    if (update.$set) {
      Object.assign(existing, update.$set);
    }
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        const current = Number((existing as Record<string, unknown>)[key] ?? 0);
        (existing as Record<string, unknown>)[key] = current + value;
      }
    }
  }

  async updateMany(
    filter: Query<T>,
    update: {
      $set?: Partial<T>;
    },
  ): Promise<void> {
    for (const row of this.#rows) {
      if (this.#matches(row, filter) && update.$set) {
        Object.assign(row, update.$set);
      }
    }
  }

  async deleteOne(filter: Query<T>): Promise<void> {
    const index = this.#rows.findIndex((row) => this.#matches(row, filter));
    if (index >= 0) {
      this.#rows.splice(index, 1);
    }
  }

  async deleteMany(filter: Query<T>): Promise<void> {
    this.#rows = this.#rows.filter((row) => !this.#matches(row, filter));
  }

  #matches(row: T, query: Query<T>): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && row[key as keyof T] !== value) return false;
    }
    return true;
  }
}

function createStore() {
  const users = new MemoryCollection<UserDocument>();
  const settings = new MemoryCollection<SettingsDocument>();
  const watches = new MemoryCollection<WatchDocument>();
  const priceChecks = new MemoryCollection<PriceCheckDocument>();
  const store = createBillingStoreFromCollections(
    {
      jobs: new MemoryCollection<JobDocument>(),
      settings,
      overlays: new MemoryCollection<OverlayDocument>(),
      runs: new MemoryCollection<RunDocument>(),
      watches,
      priceChecks,
      users,
    },
    async () => {},
  );
  return { store, users, settings, watches, priceChecks };
}

function makeWatch(overrides: Partial<WatchDocument> = {}): WatchDocument {
  return {
    id: 'watch-1',
    userId: 'user-1',
    url: 'https://example.com/product',
    title: 'Example Product',
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

function makePriceCheck(overrides: Partial<PriceCheckDocument> = {}): PriceCheckDocument {
  return {
    id: 'check-1',
    watchId: 'watch-1',
    userId: 'user-1',
    status: 'running',
    price: null,
    currency: null,
    source: null,
    previousPrice: null,
    dropped: null,
    error: null,
    checkedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('mongo store', () => {
  it('upsertJob and listJobs round-trip', async () => {
    const { store } = createStore();
    const job: JobDocument = {
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

    await store.upsertJob(job);
    const jobs = await store.listJobs();

    assert.deepEqual(jobs, [job]);
  });

  it('listJobs filters by userId when provided', async () => {
    const { store } = createStore();
    const jobForUser1: JobDocument = {
      id: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      enabled: true,
      schedule: '0 9 * * *',
      credentialsEnv: {},
      notify: { title: 'TNPDCL Bill' },
    };
    const jobForUser2: JobDocument = {
      ...jobForUser1,
      id: 'other-eb',
      userId: 'user-2',
    };

    await store.upsertJob(jobForUser1);
    await store.upsertJob(jobForUser2);

    const allJobs = await store.listJobs();
    assert.deepEqual(
      allJobs.map((job) => job.id).sort(),
      ['home-eb', 'other-eb'],
    );

    const user1Jobs = await store.listJobs({ userId: 'user-1' });
    assert.deepEqual(user1Jobs, [jobForUser1]);
  });

  it('listRuns filters by userId when provided', async () => {
    const { store } = createStore();
    const runForUser1: RunDocument = {
      id: 'run-1',
      jobId: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      status: 'success',
      startedAt: '2026-08-09T00:00:00.000Z',
      finishedAt: '2026-08-09T00:01:00.000Z',
      durationMs: 60_000,
      errorCode: null,
      errorMessage: null,
      screenshotPath: null,
      recoveryAttempted: false,
      recoverySucceeded: false,
      overlayActivated: false,
      billSummary: null,
    };
    const runForUser2: RunDocument = {
      ...runForUser1,
      id: 'run-2',
      userId: 'user-2',
    };

    await store.createRun(runForUser1);
    await store.createRun(runForUser2);

    const allRuns = await store.listRuns();
    assert.deepEqual(
      allRuns.map((run) => run.id).sort(),
      ['run-1', 'run-2'],
    );

    const user1Runs = await store.listRuns({ userId: 'user-1' });
    assert.deepEqual(user1Runs, [runForUser1]);
  });

  it('upsertWatch and listWatches round-trip with user filtering', async () => {
    const { store } = createStore();
    const watchForUser1 = makeWatch({ id: 'watch-1', userId: 'user-1' });
    const watchForUser2 = makeWatch({
      id: 'watch-2',
      userId: 'user-2',
      url: 'https://example.com/other',
    });

    await store.upsertWatch(watchForUser1);
    await store.upsertWatch(watchForUser2);

    const all = await store.listWatches();
    assert.deepEqual(
      all.map((watch) => watch.id).sort(),
      ['watch-1', 'watch-2'],
    );

    const user1 = await store.listWatches({ userId: 'user-1' });
    assert.deepEqual(user1, [watchForUser1]);
  });

  it('createPriceCheck and finishPriceCheck update persisted checks', async () => {
    const { store } = createStore();
    const check = makePriceCheck({
      id: 'check-1',
      checkedAt: '2026-08-11T00:00:00.000Z',
    });
    const newer = makePriceCheck({
      id: 'check-2',
      checkedAt: '2026-08-11T00:05:00.000Z',
      status: 'success',
      price: 4999,
      currency: 'INR',
      source: 'shopify_json',
    });

    await store.createPriceCheck(check);
    await store.createPriceCheck(newer);
    await store.finishPriceCheck('check-1', {
      status: 'failed',
      error: 'extract failed',
    });

    const checks = await store.listPriceChecks({
      watchId: 'watch-1',
      userId: 'user-1',
    });
    assert.equal(checks.length, 2);
    assert.equal(checks[0]?.id, 'check-2');
    assert.equal(checks[1]?.id, 'check-1');
    assert.equal(checks[1]?.status, 'failed');
    assert.equal(checks[1]?.error, 'extract failed');
  });

  it('deleteWatch cascades price_checks before deleting the watch', async () => {
    const { store } = createStore();
    await store.upsertWatch(makeWatch({ id: 'watch-a' }));
    await store.upsertWatch(makeWatch({ id: 'watch-b' }));
    await store.createPriceCheck(makePriceCheck({ id: 'check-a', watchId: 'watch-a' }));
    await store.createPriceCheck(makePriceCheck({ id: 'check-b', watchId: 'watch-b' }));

    await store.deleteWatch('watch-a');

    const watches = await store.listWatches();
    assert.deepEqual(watches.map((watch) => watch.id), ['watch-b']);
    const checksForDeleted = await store.listPriceChecks({ watchId: 'watch-a' });
    const checksForLive = await store.listPriceChecks({ watchId: 'watch-b' });
    assert.equal(checksForDeleted.length, 0);
    assert.equal(checksForLive.length, 1);
  });

  it('getSettings backfills missing watchesGeneration to zero', async () => {
    const { store, settings } = createStore();
    await settings.insertOne({
      id: 'default',
      ntfy: { baseUrl: 'https://ntfy.sh', topicEnv: 'NTFY_TOPIC', priority: 'default' },
      mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
      browser: { headless: true, timeoutMs: 60_000, saveErrorScreenshot: true },
      jobsGeneration: 7,
    } as SettingsDocument);

    const loaded = await store.getSettings();
    assert.equal(loaded.jobsGeneration, 7);
    assert.equal(loaded.watchesGeneration, 0);
  });

  it('upsertSettings backfills missing generation fields to zero', async () => {
    const { store } = createStore();
    await (store as unknown as {
      upsertSettings(settings: Record<string, unknown>): Promise<void>;
    }).upsertSettings({
      ntfy: { baseUrl: 'https://ntfy.sh', topicEnv: 'NTFY_TOPIC', priority: 'default' },
      mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
      browser: { headless: true, timeoutMs: 60_000, saveErrorScreenshot: true },
    });

    const loaded = await store.getSettings();
    assert.equal(loaded.jobsGeneration, 0);
    assert.equal(loaded.watchesGeneration, 0);
  });

  it('findUserByEmail matches lowercase email and getUser looks up by id', async () => {
    const { store, users } = createStore();
    const user: UserDocument = {
      id: 'user-1',
      email: 'person@example.com',
      passwordHash: 'hashed',
      createdAt: '2026-08-09T00:00:00.000Z',
    };
    await users.insertOne(user);

    const foundByEmail = await store.findUserByEmail('PERSON@example.com');
    assert.deepEqual(foundByEmail, user);

    const foundById = await store.getUser('user-1');
    assert.deepEqual(foundById, user);

    const missing = await store.findUserByEmail('missing@example.com');
    assert.equal(missing, null);
  });

  it('recordOverlaySuccess activates after three successes', async () => {
    const { store } = createStore();
    const patch: SelectorOverlayPatch = { username: '#userName' };
    const first = await store.recordOverlaySuccess({
      provider: 'tnpdcl',
      jobId: 'home-eb',
      fingerprint: 'f1',
      patch,
    });
    const second = await store.recordOverlaySuccess({
      provider: 'tnpdcl',
      jobId: 'home-eb',
      fingerprint: 'f1',
      patch,
    });
    const third = await store.recordOverlaySuccess({
      provider: 'tnpdcl',
      jobId: 'home-eb',
      fingerprint: 'f1',
      patch,
    });

    assert.equal(first.status, 'candidate');
    assert.equal(first.successCount, 1);
    assert.equal(second.status, 'candidate');
    assert.equal(second.successCount, 2);
    assert.equal(third.status, 'active');
    assert.equal(third.successCount, 3);

    const active = await store.listActiveOverlays({
      provider: 'tnpdcl',
      jobId: 'home-eb',
      fingerprint: 'f1',
    });
    assert.equal(active.length, 1);
    assert.equal(active[0]?.status, 'active');
    assert.equal(active[0]?.successCount, 3);
  });
});
