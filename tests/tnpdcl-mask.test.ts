import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyLoginFailure,
  maskAccount,
} from '../src/adapters/tnpdcl.ts';
import {
  getAdapter,
  registerBuiltInAdapters,
} from '../src/adapters/registry.ts';
import { tnpdclAdapter } from '../src/adapters/tnpdcl.ts';

describe('maskAccount', () => {
  it('masks all but the last 4 digits', () => {
    assert.equal(maskAccount('1234567890'), '****7890');
  });

  it('trims whitespace before masking', () => {
    assert.equal(maskAccount('  1234567890  '), '****7890');
  });

  it('fully masks ids with 4 or fewer characters', () => {
    assert.equal(maskAccount('12'), '****');
    assert.equal(maskAccount('1234'), '****');
    assert.equal(maskAccount(' 1234 '), '****');
  });
});

describe('classifyLoginFailure', () => {
  it('classifies clear captcha rejection messages as captcha failures', () => {
    assert.equal(classifyLoginFailure('Invalid captcha'), 'captcha');
    assert.equal(classifyLoginFailure('Captcha code mismatch. Please retry.'), 'captcha');
    assert.equal(classifyLoginFailure('The entered code is wrong for the CAPTCHA'), 'captcha');
  });

  it('defaults other login-page messages to login failures', () => {
    assert.equal(classifyLoginFailure('Invalid username or password'), 'login');
    assert.equal(
      classifyLoginFailure('Login invalid. Enter the captcha shown below.'),
      'login',
    );
    assert.equal(classifyLoginFailure(''), 'login');
  });
});

describe('adapter registry (tnpdcl)', () => {
  it('registers the tnpdcl adapter', () => {
    registerBuiltInAdapters();
    assert.equal(getAdapter('tnpdcl'), tnpdclAdapter);
    assert.equal(tnpdclAdapter.id, 'tnpdcl');
  });
});
