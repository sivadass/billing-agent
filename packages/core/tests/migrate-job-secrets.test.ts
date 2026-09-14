import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrateJobSecrets } from '../src/migrate-job-secrets.ts';
import { decryptSecret } from '../src/secrets.ts';
import type {
  BillingStore,
  JobDocument,
  SecretDocument,
} from '../src/store/types.ts';

function createMemoryStore(): BillingStore {
  const jobs = new Map<string, JobDocument>();
  const secrets = new Map<string, SecretDocument>();

  return {
    async getSettings() {
      throw new Error('not used');
    },
    async listJobs() {
      return [...jobs.values()].sort((a, b) => a.id.localeCompare(b.id));
    },
    async getJob(id) {
      return jobs.get(id) ?? null;
    },
    async upsertJob(job) {
      jobs.set(job.id, job);
    },
    async listSecrets(jobId) {
      return [...secrets.values()]
        .filter((secret) => secret.jobId === jobId)
        .sort((a, b) => a.key.localeCompare(b.key));
    },
    async upsertSecret(doc) {
      const key = `${doc.jobId}\0${doc.key}`;
      const existing = secrets.get(key);
      if (existing) {
        secrets.set(key, {
          ...existing,
          ciphertext: doc.ciphertext,
          iv: doc.iv,
          tag: doc.tag,
          updatedAt: doc.updatedAt,
        });
        return;
      }
      secrets.set(key, doc);
    },
    async unsetJobCredentialsEnv(jobId) {
      const job = jobs.get(jobId);
      if (!job) return;
      const { credentialsEnv: _ignored, ...rest } = job;
      jobs.set(jobId, rest);
    },
    async upsertSettings() {},
    async listWatches() {
      return [];
    },
    async getWatch() {
      return null;
    },
    async upsertWatch() {},
    async deleteWatch() {},
    async createPriceCheck() {},
    async finishPriceCheck() {},
    async listPriceChecks() {
      return [];
    },
    async listActiveOverlays() {
      return [];
    },
    async recordOverlaySuccess(input) {
      return {
        provider: input.provider,
        jobId: input.jobId,
        fingerprint: input.fingerprint,
        patch: input.patch,
        successCount: 1,
        status: 'candidate' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    async createRun() {},
    async finishRun() {},
    async listRuns() {
      return [];
    },
    async getRun() {
      return null;
    },
    async findUserByEmail() {
      return null;
    },
    async getUser() {
      return null;
    },
    async close() {},
  };
}

const env = {
  TNPDCL_USERNAME: 'u1',
  TNPDCL_PASSWORD: 'p1',
  SECRETS_MASTER_KEY: '11'.repeat(32),
};

describe('migrateJobSecrets', () => {
  it('copies env values into encrypted secrets and unsets credentialsEnv', async () => {
    const store = createMemoryStore();
    await store.upsertJob({
      id: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      credentialsEnv: {
        username: 'TNPDCL_USERNAME',
        password: 'TNPDCL_PASSWORD',
      },
      notify: { title: 'Bill' },
    });

    await migrateJobSecrets({ store, env });

    const rows = await store.listSecrets('home-eb');
    assert.equal(rows.length, 2);
    const key = Buffer.from(env.SECRETS_MASTER_KEY, 'hex');
    const username = rows.find((row) => row.key === 'username');
    const password = rows.find((row) => row.key === 'password');
    assert.ok(username);
    assert.ok(password);
    assert.equal(decryptSecret(username, key), 'u1');
    assert.equal(decryptSecret(password, key), 'p1');

    const job = await store.getJob('home-eb');
    assert.equal(job?.credentialsEnv, undefined);
  });

  it('is idempotent on a second run', async () => {
    const store = createMemoryStore();
    await store.upsertJob({
      id: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      credentialsEnv: {
        username: 'TNPDCL_USERNAME',
        password: 'TNPDCL_PASSWORD',
      },
      notify: { title: 'Bill' },
    });

    await migrateJobSecrets({ store, env });
    const afterFirst = await store.listSecrets('home-eb');
    await migrateJobSecrets({ store, env });
    const afterSecond = await store.listSecrets('home-eb');
    assert.equal(afterSecond.length, 2);
    assert.equal(afterSecond[0]?.ciphertext, afterFirst[0]?.ciphertext);
    assert.equal(afterSecond[1]?.ciphertext, afterFirst[1]?.ciphertext);
  });

  it('unsets credentialsEnv when env var is missing without creating a secret', async () => {
    const store = createMemoryStore();
    await store.upsertJob({
      id: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      credentialsEnv: { username: 'MISSING' },
      notify: { title: 'Bill' },
    });

    await migrateJobSecrets({ store, env: { SECRETS_MASTER_KEY: env.SECRETS_MASTER_KEY } });

    const rows = await store.listSecrets('home-eb');
    assert.equal(rows.length, 0);
    const job = await store.getJob('home-eb');
    assert.equal(job?.credentialsEnv, undefined);
  });
});
