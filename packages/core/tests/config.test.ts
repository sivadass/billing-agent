import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  loadSeedConfig,
  resolveJobSecrets,
  resolveMistralApiKey,
} from '../src/config.ts';
import { ConfigError } from '../src/errors.ts';
import { encryptSecret } from '../src/secrets.ts';
import type { BillingStore, JobDocument, SecretDocument } from '../src/store/types.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(dir, 'fixtures', 'jobs.valid.json');
const exampleConfig = path.join(dir, '..', '..', '..', 'jobs.example.json');

describe('jobs.example.json', () => {
  it('seeds the canonical sivadass-in-email workflow job alongside the adapter jobs', () => {
    const seed = loadSeedConfig({ configPath: exampleConfig });
    const job = seed.jobs.find((candidate) => candidate.id === 'sivadass-in-email');

    assert.ok(job, 'jobs.example.json must include sivadass-in-email');
    assert.equal(job.engine, 'workflow');
    assert.equal(job.startUrl, 'https://sivadass.in/');
    assert.equal(job.adapterId, undefined);
    assert.deepEqual(job.schema, [
      { key: 'email', label: 'Email', type: 'string' },
    ]);
    assert.deepEqual(job.workflow, [
      { id: 'goto-home', type: 'goto', url: 'https://sivadass.in/' },
      {
        id: 'extract-email',
        type: 'extract',
        fields: [{ key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' }],
      },
    ]);
    assert.deepEqual(job.secretIds, []);
    assert.equal(job.notify.on, 'always');

    const adapterJobs = seed.jobs.filter((candidate) => candidate.engine === 'adapter');
    assert.deepEqual(
      adapterJobs.map((candidate) => candidate.id),
      ['home-eb', 'smoke-test'],
    );
  });
});

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
    assert.equal(job.adapterId, 'tnpdcl');
    assert.equal(job.engine, 'adapter');
  });

  it('throws when ntfy topic env is missing', () => {
    assert.throws(
      () => loadConfig({ configPath: fixture, env: {} }),
      (err: unknown) => err instanceof ConfigError,
    );
  });

  it('loads new-shape adapter jobs from fixture', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    const smoke = cfg.jobs.find((j) => j.id === 'smoke-test');
    assert.ok(smoke);
    assert.equal(smoke.engine, 'adapter');
    assert.equal(smoke.adapterId, 'dummy');
  });
});

const TEST_MASTER_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_MASTER_KEY = Buffer.from(TEST_MASTER_KEY_HEX, 'hex');

function makeSecretDoc(overrides: Partial<SecretDocument> = {}): SecretDocument {
  return {
    id: 'secret-1',
    userId: 'user-1',
    jobId: 'home-eb',
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

function storeWithSecrets(secrets: SecretDocument[]): BillingStore {
  return {
    listSecrets: async (options) =>
      secrets.filter(
        (secret) =>
          secret.userId === options.userId &&
          (options.jobId === undefined || secret.jobId === options.jobId),
      ),
  } as unknown as BillingStore;
}

describe('resolveJobSecrets', () => {
  it('decrypts stored secret documents, keyed by secret.key', async () => {
    const job: JobDocument = {
      ...(loadConfig({
        configPath: fixture,
        env: { NTFY_TOPIC: 'bills' },
      }).jobs.find((j) => j.id === 'home-eb') as JobDocument),
      secretIds: ['secret-1', 'secret-2'],
    };
    const usernameSecret = makeSecretDoc({
      id: 'secret-1',
      key: 'username',
      ...encryptSecret('user1', TEST_MASTER_KEY),
    });
    const passwordSecret = makeSecretDoc({
      id: 'secret-2',
      key: 'password',
      ...encryptSecret('pass1', TEST_MASTER_KEY),
    });
    const store = storeWithSecrets([usernameSecret, passwordSecret]);

    const secrets = await resolveJobSecrets(job, store, {
      SECRETS_MASTER_KEY: TEST_MASTER_KEY_HEX,
    });

    assert.deepEqual(secrets, { username: 'user1', password: 'pass1' });
  });

  it('never leaks ciphertext or plaintext into the returned keys/values beyond the intended mapping', async () => {
    const job: JobDocument = {
      ...(loadConfig({
        configPath: fixture,
        env: { NTFY_TOPIC: 'bills' },
      }).jobs.find((j) => j.id === 'home-eb') as JobDocument),
      secretIds: ['secret-1'],
    };
    const encrypted = encryptSecret('super-secret-password', TEST_MASTER_KEY);
    const store = storeWithSecrets([
      makeSecretDoc({ id: 'secret-1', key: 'password', ...encrypted }),
    ]);

    const secrets = await resolveJobSecrets(job, store, {
      SECRETS_MASTER_KEY: TEST_MASTER_KEY_HEX,
    });

    assert.deepEqual(Object.keys(secrets), ['password']);
    assert.equal(secrets.password, 'super-secret-password');
    assert.notEqual(secrets.password, encrypted.ciphertext);
  });

  it('only resolves secrets referenced by job.secretIds, ignoring other secrets for the same job', async () => {
    const job: JobDocument = {
      ...(loadConfig({
        configPath: fixture,
        env: { NTFY_TOPIC: 'bills' },
      }).jobs.find((j) => j.id === 'home-eb') as JobDocument),
      secretIds: ['secret-1'],
    };
    const included = makeSecretDoc({
      id: 'secret-1',
      key: 'username',
      ...encryptSecret('user1', TEST_MASTER_KEY),
    });
    const excluded = makeSecretDoc({
      id: 'secret-unrelated',
      key: 'other',
      ...encryptSecret('should-not-appear', TEST_MASTER_KEY),
    });
    const store = storeWithSecrets([included, excluded]);

    const secrets = await resolveJobSecrets(job, store, {
      SECRETS_MASTER_KEY: TEST_MASTER_KEY_HEX,
    });

    assert.deepEqual(secrets, { username: 'user1' });
  });

  it('resolves to an empty object for jobs with no secretIds, without requiring a master key', async () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    const job = cfg.jobs.find((j) => j.id === 'smoke-test');
    assert.ok(job);
    assert.deepEqual(job.secretIds, []);

    const store = storeWithSecrets([]);
    const secrets = await resolveJobSecrets(job, store, {});
    assert.deepEqual(secrets, {});
  });

  it('throws ConfigError when secrets are referenced but the master key is missing', async () => {
    const job: JobDocument = {
      ...(loadConfig({
        configPath: fixture,
        env: { NTFY_TOPIC: 'bills' },
      }).jobs.find((j) => j.id === 'home-eb') as JobDocument),
      secretIds: ['secret-1'],
    };
    const store = storeWithSecrets([makeSecretDoc({ id: 'secret-1' })]);

    await assert.rejects(
      resolveJobSecrets(job, store, {}),
      (err: unknown) => err instanceof ConfigError,
    );
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

describe('loadSeedConfig', () => {
  it('resolves ntfy topic from NTFY_TOPIC when topicEnv is absent', () => {
    const minimalFixture = path.join(dir, 'fixtures', 'jobs.ntfy-fallback.json');
    const cfg = loadConfig({
      configPath: minimalFixture,
      env: { NTFY_TOPIC: 'fallback-topic' },
    });
    assert.equal(cfg.ntfy.topic, 'fallback-topic');
  });

  it('parses a legacy provider job into an adapter JobDocument, ignoring the unused credentials block', () => {
    const cfg = loadSeedConfig({ configPath: fixture });
    const job = cfg.jobs.find((j) => j.id === 'home-eb');
    assert.ok(job);
    assert.equal(job.engine, 'adapter');
    assert.equal(job.adapterId, 'tnpdcl');
    assert.deepEqual(job.secretIds, []);
  });
});
