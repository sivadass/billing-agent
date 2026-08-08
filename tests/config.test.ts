import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { ConfigError } from '../src/errors.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(dir, 'fixtures', 'jobs.valid.json');

describe('loadConfig', () => {
  it('resolves env refs', () => {
    const cfg = loadConfig({
      configPath: fixture,
      env: {
        NTFY_TOPIC: 'bills',
        MISTRAL_API_KEY: 'mk-test',
        TNPDCL_USERNAME: 'user1',
        TNPDCL_PASSWORD: 'pass1',
      },
    });
    assert.equal(cfg.ntfy.topic, 'bills');
    assert.equal(cfg.mistral.apiKey, 'mk-test');
    const job = cfg.jobs.find((j) => j.id === 'home-eb');
    assert.ok(job);
    assert.equal(job.credentials.username, 'user1');
    assert.equal(job.credentials.password, 'pass1');
  });

  it('throws when required env missing', () => {
    assert.throws(
      () => loadConfig({ configPath: fixture, env: {} }),
      (err: unknown) => err instanceof ConfigError,
    );
  });
});
