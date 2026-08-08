import { createHash } from 'node:crypto';
import { ConfigError } from './errors.js';

export type SelectorOverlay = Record<string, string | string[]>;

const MAX_OVERLAY_KEYS = 16;
const MAX_OVERLAY_TEXT_LENGTH = 512;

const allowedKeys = new Set([
  'username',
  'password',
  'captchaInput',
  'captchaImage',
  'loginButton',
  'loginError',
  'amount',
  'dueDate',
  'billPeriod',
  'status',
  'accountLabel',
]);

function assertOverlayString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`overlay key "${key}" must be a non-empty string`);
  }
  if (value.length > MAX_OVERLAY_TEXT_LENGTH) {
    throw new ConfigError(`overlay key "${key}" exceeds max length`);
  }
  return value;
}

export function validateOverlayPatch(raw: unknown): SelectorOverlay {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError('overlay patch must be an object');
  }

  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new ConfigError('overlay patch must not be empty');
  }
  if (entries.length > MAX_OVERLAY_KEYS) {
    throw new ConfigError('overlay patch exceeds max key count');
  }

  const patch: SelectorOverlay = {};
  for (const [key, value] of entries) {
    if (!allowedKeys.has(key)) {
      throw new ConfigError(`unknown overlay key: ${key}`);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        throw new ConfigError(`overlay key "${key}" must not be an empty array`);
      }
      patch[key] = value.map((item) => assertOverlayString(item, key));
      continue;
    }
    patch[key] = assertOverlayString(value, key);
  }

  return patch;
}

export function fingerprintFailure(input: {
  code: string;
  step?: string;
  urlPath?: string;
  title?: string;
}): string {
  const payload = JSON.stringify({
    code: input.code,
    step: input.step ?? '',
    urlPath: input.urlPath ?? '',
    title: input.title ?? '',
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function mergeSelectors<T extends Record<string, string>>(
  defaults: T,
  overlay?: SelectorOverlay,
): T {
  if (!overlay) return { ...defaults };
  const merged: Record<string, string> = { ...defaults };
  for (const [key, value] of Object.entries(overlay)) {
    if (typeof value !== 'string') continue;
    if (!(key in merged)) continue;
    merged[key] = value;
  }
  return merged as T;
}
