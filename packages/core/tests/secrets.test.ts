import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decryptSecret,
  encryptSecret,
  parseMasterKey,
} from '../src/secrets.ts';
import { ConfigError } from '../src/errors.ts';

const hex = '11'.repeat(32);

describe('secrets', () => {
  it('round-trips plaintext', () => {
    const key = parseMasterKey({ SECRETS_MASTER_KEY: hex });
    const enc = encryptSecret('hunter2', key);
    assert.equal(decryptSecret(enc, key), 'hunter2');
  });

  it('throws ConfigError for missing or short keys', () => {
    assert.throws(() => parseMasterKey({}), (err) => err instanceof ConfigError);
    assert.throws(
      () => parseMasterKey({ SECRETS_MASTER_KEY: 'abcd' }),
      (err) => err instanceof ConfigError,
    );
  });

  it('throws when decrypting with the wrong key', () => {
    const a = parseMasterKey({ SECRETS_MASTER_KEY: hex });
    const b = parseMasterKey({ SECRETS_MASTER_KEY: '22'.repeat(32) });
    const enc = encryptSecret('hunter2', a);
    assert.throws(() => decryptSecret(enc, b));
  });
});
