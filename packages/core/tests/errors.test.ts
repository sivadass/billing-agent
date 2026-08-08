import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, CaptchaError } from '../src/errors.ts';

describe('errors', () => {
  it('exposes stable error codes', () => {
    const err = new ConfigError('missing topic');
    assert.equal(err.code, 'ConfigError');
    assert.equal(err.name, 'ConfigError');
    assert.match(err.message, /missing topic/);
  });

  it('CaptchaError is distinguishable', () => {
    const err = new CaptchaError('empty ocr');
    assert.equal(err.code, 'CaptchaError');
  });
});
