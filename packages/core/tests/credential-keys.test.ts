import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  listAdapterProviders,
  requiredCredentialKeys,
  validateSecretPayload,
} from '../src/adapters/credential-keys.ts';

describe('adapter credential keys', () => {
  it('lists tnpdcl username/password and dummy empty', () => {
    assert.deepEqual(listAdapterProviders(), [
      { id: 'tnpdcl', credentialKeys: ['username', 'password'] },
      { id: 'dummy', credentialKeys: [] },
    ]);
    assert.deepEqual(requiredCredentialKeys('tnpdcl'), ['username', 'password']);
    assert.deepEqual(requiredCredentialKeys('dummy'), []);
    assert.deepEqual(requiredCredentialKeys('unknown'), []);
  });

  it('validates create and update payloads', () => {
    assert.equal(
      validateSecretPayload(
        'tnpdcl',
        { username: 'u', password: 'p' },
        'create',
      ),
      null,
    );
    assert.match(
      validateSecretPayload('tnpdcl', { username: 'u' }, 'create') ?? '',
      /password/i,
    );
    assert.match(
      validateSecretPayload('tnpdcl', { username: 'u', password: '' }, 'create') ?? '',
      /empty/i,
    );
    assert.match(
      validateSecretPayload('tnpdcl', { username: 'u', extra: 'x' }, 'create') ?? '',
      /unknown/i,
    );
    assert.equal(
      validateSecretPayload('tnpdcl', { password: 'new' }, 'update'),
      null,
    );
    assert.match(
      validateSecretPayload('dummy', { username: 'u' }, 'create') ?? '',
      /unknown/i,
    );
    assert.equal(validateSecretPayload('dummy', {}, 'create'), null);
  });
});
