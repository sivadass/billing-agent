import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOKEN_STORAGE_KEY,
  clearApiTokenOverride,
  getApiToken,
  setApiTokenOverride,
} from './auth-token';

describe('auth-token', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_API_TOKEN', 'env-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    sessionStorage.clear();
  });

  it('returns session override over env token', () => {
    setApiTokenOverride('override-token');
    expect(getApiToken()).toBe('override-token');
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe('override-token');
  });

  it('falls back to VITE_API_TOKEN when no override', () => {
    expect(getApiToken()).toBe('env-token');
  });

  it('returns null when neither override nor env is set', () => {
    vi.stubEnv('VITE_API_TOKEN', '');
    expect(getApiToken()).toBeNull();
  });

  it('clearApiTokenOverride restores env fallback', () => {
    setApiTokenOverride('override-token');
    clearApiTokenOverride();
    expect(getApiToken()).toBe('env-token');
  });
});
