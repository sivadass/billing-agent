import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth-password.ts';

describe('auth-password', () => {
  it('hashes a password with a bcrypt cost-10 hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.match(hash, /^\$2[aby]\$10\$/);
  });

  it('verifies a matching password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  });

  it('rejects a non-matching password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword('wrong password', hash), false);
  });
});
