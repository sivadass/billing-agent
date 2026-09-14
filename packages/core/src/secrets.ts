import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConfigError } from './errors.js';

const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

export function parseMasterKey(env: NodeJS.ProcessEnv): Buffer {
  const value = env.SECRETS_MASTER_KEY;
  if (!value) {
    throw new ConfigError(
      'Missing or invalid environment variable: SECRETS_MASTER_KEY',
    );
  }

  if (HEX_KEY_PATTERN.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new ConfigError(
      'Missing or invalid environment variable: SECRETS_MASTER_KEY',
    );
  }

  return key;
}

export function encryptSecret(
  plaintext: string,
  key: Buffer,
): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret(
  doc: { ciphertext: string; iv: string; tag: string },
  key: Buffer,
): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(doc.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(doc.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(doc.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
