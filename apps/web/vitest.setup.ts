import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

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
