import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fingerprintFailure,
  mergeSelectors,
  validateOverlayPatch,
} from '../src/overlay.ts';
import { ConfigError } from '../src/errors.ts';

describe('validateOverlayPatch', () => {
  it('rejects unknown keys', () => {
    assert.throws(
      () =>
        validateOverlayPatch({
          username: '#userName',
          unknown: '.foo',
        }),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.message.includes('unknown overlay key: unknown'),
    );
  });
});

describe('mergeSelectors', () => {
  it('overrides known selectors with overlay values', () => {
    const merged = mergeSelectors(
      {
        username: '#username',
        password: '#password',
      },
      {
        username: '#userName',
      },
    );

    assert.deepEqual(merged, {
      username: '#userName',
      password: '#password',
    });
  });
});

describe('fingerprintFailure', () => {
  it('is stable for the same input', () => {
    const input = {
      code: 'LoginError',
      step: 'submit-login',
      urlPath: '/awp/login',
      title: 'TNPDCL Login',
    };
    const first = fingerprintFailure(input);
    const second = fingerprintFailure(input);
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });
});
