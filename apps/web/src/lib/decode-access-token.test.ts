import { describe, expect, it } from 'vitest';
import { decodeAccessToken } from './decode-access-token';

function encodeSegment(value: object | string): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: object): string {
  return `${encodeSegment({ alg: 'none' })}.${encodeSegment(payload)}.sig`;
}

describe('decodeAccessToken', () => {
  it('returns userId and email from a valid JWT payload', () => {
    const token = makeToken({ sub: 'user-1', email: 'you@example.com' });
    expect(decodeAccessToken(token)).toEqual({
      userId: 'user-1',
      email: 'you@example.com',
    });
  });

  it('returns null when email claim is missing', () => {
    expect(decodeAccessToken(makeToken({ sub: 'user-1' }))).toBeNull();
  });

  it('returns null when sub claim is missing', () => {
    expect(decodeAccessToken(makeToken({ email: 'you@example.com' }))).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    expect(decodeAccessToken('not-a-jwt')).toBeNull();
    expect(decodeAccessToken('a.b')).toBeNull();
    expect(decodeAccessToken(`x.${encodeSegment('not-json')}.y`)).toBeNull();
  });
});
