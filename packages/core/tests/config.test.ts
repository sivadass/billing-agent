import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  resolveJobCredentials,
  resolveMistralApiKey,
} from '../src/config.ts';
import { ConfigError } from '../src/errors.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(dir, 'fixtures', 'jobs.valid.json');

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

describe('resolveJobCredentials', () => {
  it('resolves credential env vars lazily', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    const job = cfg.jobs.find((j) => j.id === 'home-eb');
    assert.ok(job);

    const credentials = resolveJobCredentials(job, {
      TNPDCL_USERNAME: 'user1',
      TNPDCL_PASSWORD: 'pass1',
    });
    assert.deepEqual(credentials, { username: 'user1', password: 'pass1' });
  });

  it('throws when a credential env var is missing', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    const job = cfg.jobs.find((j) => j.id === 'home-eb');
    assert.ok(job);

    assert.throws(
      () => resolveJobCredentials(job, {}),
      (err: unknown) => err instanceof ConfigError,
    );
  });

  it('resolves to an empty object for jobs with no credentials', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: { NTFY_TOPIC: 'bills' },
    });
    const job = cfg.jobs.find((j) => j.id === 'smoke-test');
    assert.ok(job);
    assert.deepEqual(resolveJobCredentials(job, {}), {});
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
