import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretDocument } from './store/types.js';
import { ConfigError } from './errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const CONFIG_ERROR_MESSAGE =
  'Missing or invalid environment variable: SECRETS_MASTER_KEY';

function parseKeyValue(value: string): Buffer | null {
  if (value.length === 64 && /^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }
  if (value.length === 44) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === KEY_LENGTH) {
      return decoded;
    }
  }
  return null;
}

export function parseMasterKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.SECRETS_MASTER_KEY;
  if (!raw) {
    throw new ConfigError(CONFIG_ERROR_MESSAGE);
  }
  const key = parseKeyValue(raw);
  if (!key) {
    throw new ConfigError(CONFIG_ERROR_MESSAGE);
  }
  return key;
}

export function encryptSecret(
  plaintext: string,
  key: Buffer,
): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
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
  doc: Pick<SecretDocument, 'ciphertext' | 'iv' | 'tag'>,
  key: Buffer,
): string {
  const decipher = createDecipheriv(
    ALGORITHM,
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
