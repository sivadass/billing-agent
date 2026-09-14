import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBrowserLock } from '../src/browser-lock.ts';

describe('createBrowserLock', () => {
  it('starts unheld', () => {
    assert.equal(createBrowserLock().current(), null);
  });

  it('refuses a second acquire and grants it again after release', () => {
    const lock = createBrowserLock();

    assert.equal(lock.tryAcquire({ kind: 'run', id: 'run-1' }), true);
    assert.equal(lock.tryAcquire({ kind: 'authoring', id: 'conv-1' }), false);
    assert.deepEqual(lock.current(), { kind: 'run', id: 'run-1' });

    lock.release('run-1');

    assert.equal(lock.current(), null);
    assert.equal(lock.tryAcquire({ kind: 'authoring', id: 'conv-1' }), true);
    assert.deepEqual(lock.current(), { kind: 'authoring', id: 'conv-1' });
  });

  it('refuses a re-acquire by the holder itself', () => {
    const lock = createBrowserLock();
    lock.tryAcquire({ kind: 'run', id: 'run-1' });

    assert.equal(lock.tryAcquire({ kind: 'run', id: 'run-1' }), false);
    assert.deepEqual(lock.current(), { kind: 'run', id: 'run-1' });
  });

  it('ignores a release from anyone but the holder', () => {
    const lock = createBrowserLock();
    lock.tryAcquire({ kind: 'run', id: 'run-1' });

    lock.release('run-2');

    assert.deepEqual(lock.current(), { kind: 'run', id: 'run-1' });
    assert.equal(lock.tryAcquire({ kind: 'run', id: 'run-2' }), false);
  });

  it('releasing an unheld lock is a no-op', () => {
    const lock = createBrowserLock();

    lock.release('run-1');

    assert.equal(lock.current(), null);
    assert.equal(lock.tryAcquire({ kind: 'run', id: 'run-1' }), true);
  });

  it('hands out copies, so a caller cannot mutate the held owner', () => {
    const lock = createBrowserLock();
    const owner = { kind: 'run' as const, id: 'run-1' };
    lock.tryAcquire(owner);

    owner.id = 'tampered';
    const current = lock.current();
    if (current) current.id = 'tampered-too';

    assert.deepEqual(lock.current(), { kind: 'run', id: 'run-1' });
  });
});
