import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOKEN_STORAGE_KEY,
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from './auth-token';

describe('auth-token', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    sessionStorage.clear();
  });

  it('returns null when sessionStorage has no JWT', () => {
    vi.stubEnv('VITE_API_TOKEN', 'env-token');
    expect(getAccessToken()).toBeNull();
  });

  it('stores and returns JWT from sessionStorage only', () => {
    setAccessToken('jwt-token');
    expect(getAccessToken()).toBe('jwt-token');
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-token');
  });

  it('ignores VITE_API_TOKEN env fallback', () => {
    vi.stubEnv('VITE_API_TOKEN', 'env-token');
    expect(getAccessToken()).toBeNull();
    setAccessToken('session-jwt');
    expect(getAccessToken()).toBe('session-jwt');
  });

  it('clearAccessToken removes the JWT', () => {
    setAccessToken('jwt-token');
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});
