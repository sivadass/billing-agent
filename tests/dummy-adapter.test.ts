import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { withBrowser } from '../src/browser.ts';
import { dummyAdapter } from '../src/adapters/dummy.ts';
import {
  getAdapter,
  registerBuiltInAdapters,
} from '../src/adapters/registry.ts';
import { ConfigError } from '../src/errors.ts';
import { createLogger } from '../src/logger.ts';

describe('dummyAdapter', () => {
  it('reads the dummy bill fixture and masks the account number', async () => {
    const result = await withBrowser(
      { headless: true, timeoutMs: 30000, saveErrorScreenshot: false },
      (page) =>
        dummyAdapter.run({
          page,
          credentials: {},
          captchaSolver: {
            solveFromImageBase64: async () => '',
          },
          timeoutMs: 30000,
          logger: createLogger('dummy-test'),
          fixturePath: resolve('fixtures/dummy-bill.html'),
        }),
    );

    assert.equal(result.amount, '₹999.00');
    assert.equal(result.accountLabel, '****7890');
  });
});

describe('adapter registry', () => {
  it('registers and returns the dummy adapter', () => {
    registerBuiltInAdapters();
    assert.equal(getAdapter('dummy'), dummyAdapter);
  });

  it('rejects unknown providers', () => {
    assert.throws(
      () => getAdapter('unknown'),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.message === 'Unknown provider: unknown',
    );
  });
});
