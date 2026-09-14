import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  resolveJobSecrets,
  resolveMistralApiKey,
} from '../src/config.ts';
import { ConfigError } from '../src/errors.ts';
import { encryptSecret } from '../src/secrets.ts';
import type { BillingStore, SecretDocument } from '../src/store/types.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(dir, 'fixtures', 'jobs.valid.json');
const masterKeyHex = '11'.repeat(32);

function createSecretsStore(
  rows: SecretDocument[],
): BillingStore {
  return {
    async getSettings() {
      throw new Error('not used');
    },
    async listJobs() {
      return [];
    },
    async getJob() {
      return null;
    },
    async upsertJob() {},
    async deleteJob() {},
    async listSecrets() {
      return rows;
    },
    async upsertSecret() {},
    async unsetJobCredentialsEnv() {},
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
    async deleteRun() {},
    async findUserByEmail() {
      return null;
    },
    async getUser() {
      return null;
    },
    async close() {},
  };
}

describe('loadConfig', () => {
  it('succeeds with only NTFY_TOPIC set, storing credential env names unresolved', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    assert.equal(cfg.ntfy.topic, 'bills');
    assert.equal(cfg.mistral.apiKeyEnv, 'MISTRAL_API_KEY');

    const job = cfg.jobs.find((j) => j.id === 'home-eb');
    assert.ok(job);
    assert.deepEqual(job.credentialsEnv, {
      username: 'TNPDCL_USERNAME',
      password: 'TNPDCL_PASSWORD',
    });
  });

  it('throws when ntfy topic env is missing', () => {
    assert.throws(
      () => loadConfig({ configPath: fixture, env: {} }),
      (err: unknown) => err instanceof ConfigError,
    );
  });
});

describe('loadConfig optional credentials', () => {
  it('parses a seed job with no credentials key', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    const job = cfg.jobs.find((j) => j.id === 'smoke-test');
    assert.ok(job);
    assert.equal(job.credentialsEnv, undefined);
  });
});

describe('resolveJobSecrets', () => {
  it('decrypts stored secrets for required provider keys', async () => {
    const key = Buffer.from(masterKeyHex, 'hex');
    const username = encryptSecret('user1', key);
    const password = encryptSecret('pass1', key);
    const store = createSecretsStore([
      {
        id: 'sec-1',
        userId: 'user-1',
        jobId: 'home-eb',
        key: 'username',
        ...username,
        createdAt: '2026-09-14T00:00:00.000Z',
        updatedAt: '2026-09-14T00:00:00.000Z',
      },
      {
        id: 'sec-2',
        userId: 'user-1',
        jobId: 'home-eb',
        key: 'password',
        ...password,
        createdAt: '2026-09-14T00:00:00.000Z',
        updatedAt: '2026-09-14T00:00:00.000Z',
      },
    ]);
    const job = {
      id: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      notify: { title: 'Bill' },
    };

    const credentials = await resolveJobSecrets(job, store, {
      SECRETS_MASTER_KEY: masterKeyHex,
    });
    assert.deepEqual(credentials, { username: 'user1', password: 'pass1' });
  });

  it('throws when a required secret is missing', async () => {
    const store = createSecretsStore([]);
    const job = {
      id: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      notify: { title: 'Bill' },
    };

    await assert.rejects(
      () =>
        resolveJobSecrets(job, store, {
          SECRETS_MASTER_KEY: masterKeyHex,
        }),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.message === 'Missing secret "username" for job home-eb',
    );
  });

  it('throws when the secrets store is missing for a provider with required keys', async () => {
    const job = {
      id: 'home-eb',
      userId: 'user-1',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      notify: { title: 'Bill' },
    };

    await assert.rejects(
      () => resolveJobSecrets(job, undefined, { SECRETS_MASTER_KEY: masterKeyHex }),
      (err: unknown) =>
        err instanceof ConfigError && err.message === 'Missing secrets store',
    );
  });

  it('returns an empty object for providers with no required keys', async () => {
    const job = {
      id: 'smoke-test',
      userId: 'user-1',
      provider: 'dummy',
      enabled: true,
      schedule: null,
      notify: { title: 'Dummy Bill' },
    };

    const credentials = await resolveJobSecrets(job, undefined, {});
    assert.deepEqual(credentials, {});
  });
});

describe('resolveMistralApiKey', () => {
  it('resolves the api key from the configured env var', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    assert.equal(
      resolveMistralApiKey(cfg.mistral, { MISTRAL_API_KEY: 'mk-test' }),
      'mk-test',
    );
  });

  it('throws when the api key env var is missing', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    assert.throws(
      () => resolveMistralApiKey(cfg.mistral, {}),
      (err: unknown) => err instanceof ConfigError,
    );
  });
});
