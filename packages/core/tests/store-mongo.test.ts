import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBillingStoreFromCollections } from '../src/store/mongo.ts';
import type {
  JobDocument,
  OverlayDocument,
  RunDocument,
  SelectorOverlayPatch,
  SettingsDocument,
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

  #matches(row: T, query: Query<T>): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && row[key as keyof T] !== value) return false;
    }
    return true;
  }
}

function createStore() {
  return createBillingStoreFromCollections(
    {
      jobs: new MemoryCollection<JobDocument>(),
      settings: new MemoryCollection<SettingsDocument>(),
      overlays: new MemoryCollection<OverlayDocument>(),
      runs: new MemoryCollection<RunDocument>(),
    },
    async () => {},
  );
}

describe('mongo store', () => {
  it('upsertJob and listJobs round-trip', async () => {
    const store = createStore();
    const job: JobDocument = {
      id: 'home-eb',
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

  it('recordOverlaySuccess activates after three successes', async () => {
    const store = createStore();
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
