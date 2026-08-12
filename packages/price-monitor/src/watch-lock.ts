const inFlightWatches = new Set<string>();

export function tryAcquireWatchLock(watchId: string): boolean {
  if (inFlightWatches.has(watchId)) {
    return false;
  }
  inFlightWatches.add(watchId);
  return true;
}

export function releaseWatchLock(watchId: string): void {
  inFlightWatches.delete(watchId);
}

export function isWatchLocked(watchId: string): boolean {
  return inFlightWatches.has(watchId);
}
