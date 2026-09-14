import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SecretDocument } from '../src/store/types.ts';
import { ConfigError } from '../src/errors.ts';
import {
  decryptSecret,
  encryptSecret,
  parseMasterKey,
} from '../src/secrets.ts';

const TEST_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_KEY_BASE64 = Buffer.from(TEST_KEY_HEX, 'hex').toString('base64');

describe('secrets', () => {
  describe('parseMasterKey', () => {
    it('parses a 64-char hex key', () => {
      const key = parseMasterKey({ SECRETS_MASTER_KEY: TEST_KEY_HEX });
      assert.equal(key.length, 32);
      assert.equal(key.toString('hex'), TEST_KEY_HEX);
    });

    it('parses a 44-char base64 key', () => {
      const key = parseMasterKey({ SECRETS_MASTER_KEY: TEST_KEY_BASE64 });
      assert.equal(key.length, 32);
      assert.equal(key.toString('hex'), TEST_KEY_HEX);
    });

    it('throws ConfigError when key is missing', () => {
      assert.throws(
        () => parseMasterKey({}),
        (err: unknown) =>
          err instanceof ConfigError &&
          err.message ===
            'Missing or invalid environment variable: SECRETS_MASTER_KEY',
      );
    });

    it('throws ConfigError when key is invalid', () => {
      assert.throws(
        () => parseMasterKey({ SECRETS_MASTER_KEY: 'not-a-valid-key' }),
        (err: unknown) =>
          err instanceof ConfigError &&
          err.message ===
            'Missing or invalid environment variable: SECRETS_MASTER_KEY',
      );
    });
  });

  describe('encryptSecret / decryptSecret', () => {
    const key = Buffer.from(TEST_KEY_HEX, 'hex');

    it('round-trips plaintext', () => {
      const plaintext = 'my-secret-password';
      const encrypted = encryptSecret(plaintext, key);
      assert.ok(encrypted.ciphertext);
      assert.ok(encrypted.iv);
      assert.ok(encrypted.tag);
      assert.equal(encrypted.iv.length, 16);
      assert.equal(Buffer.from(encrypted.iv, 'base64').length, 12);

      const doc: Pick<SecretDocument, 'ciphertext' | 'iv' | 'tag'> = encrypted;
      const decrypted = decryptSecret(doc, key);
      assert.equal(decrypted, plaintext);
    });

    it('throws when decrypting with the wrong key', () => {
      const encrypted = encryptSecret('sensitive', key);
      const wrongKey = Buffer.alloc(32, 0xff);
      assert.throws(() => decryptSecret(encrypted, wrongKey));
    });
  });
});
