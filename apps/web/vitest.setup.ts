import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `globals: false` means Testing Library cannot register its own auto-cleanup,
// so a file with more than one render would otherwise stack up DOM trees.
afterEach(() => {
  cleanup();
});

if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverMock {
    disconnect() {}
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [];
  }
  // @ts-expect-error test-only polyfill
  globalThis.IntersectionObserver = IntersectionObserverMock;
}
