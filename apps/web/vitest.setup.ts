import '@testing-library/jest-dom/vitest';

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
