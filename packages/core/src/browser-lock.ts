/** Who is holding the single Chromium the process is allowed to drive. */
export type BrowserLockOwner = { kind: 'run' | 'authoring'; id: string };

export type BrowserLock = {
  tryAcquire(owner: BrowserLockOwner): boolean;
  release(id: string): void;
  current(): BrowserLockOwner | null;
};

/**
 * Process-local mutex serializing every Chromium user: scheduled runs, Run now,
 * and (from slice 3) a chat authoring session. It is deliberately not a queue —
 * a caller that cannot have the browser is told so immediately (409, or a
 * skipped cron tick) rather than piling up sessions on a single-container
 * deployment.
 *
 * `release` only frees the lock for the holder, so a late release from an
 * already-finished run can never hand the browser away from whoever owns it
 * now. Owners are copied in and out so no caller can mutate the held identity.
 */
export function createBrowserLock(): BrowserLock {
  let owner: BrowserLockOwner | null = null;

  return {
    tryAcquire(next: BrowserLockOwner): boolean {
      if (owner) return false;
      owner = { kind: next.kind, id: next.id };
      return true;
    },
    release(id: string): void {
      if (owner?.id === id) owner = null;
    },
    current(): BrowserLockOwner | null {
      return owner ? { ...owner } : null;
    },
  };
}
