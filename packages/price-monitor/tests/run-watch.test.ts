import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  BillingStore,
  PriceCheckDocument,
  WatchDocument,
} from '@billing-agent/core';
import { runWatch, WatchBusyError } from '../src/run-watch.ts';
import { releaseWatchLock, tryAcquireWatchLock } from '../src/watch-lock.ts';

class MemoryWatchStore {
  watches = new Map<string, WatchDocument>();
  checks = new Map<string, PriceCheckDocument>();

  async getSettings() {
    throw new Error('not used');
  }

  async listJobs() {
    return [];
  }

  async getJob() {
    return null;
  }

  async upsertJob() {}

  async upsertSettings() {}

  async listWatches(options?: { userId?: string }) {
    let rows = [...this.watches.values()];
    if (options?.userId) {
      rows = rows.filter((row) => row.userId === options.userId);
    }
    return rows;
  }

  async getWatch(id: string) {
    return this.watches.get(id) ?? null;
  }

  async upsertWatch(watch: WatchDocument) {
    this.watches.set(watch.id, watch);
  }

  async deleteWatch(id: string) {
    this.watches.delete(id);
  }

  async createPriceCheck(check: PriceCheckDocument) {
    this.checks.set(check.id, check);
  }

  async finishPriceCheck(id: string, update: Partial<PriceCheckDocument>) {
    const current = this.checks.get(id);
    if (!current) return;
    this.checks.set(id, { ...current, ...update });
  }

  async listPriceChecks(options: { watchId: string; userId?: string; limit?: number }) {
    let rows = [...this.checks.values()].filter((row) => row.watchId === options.watchId);
    if (options.userId) {
      rows = rows.filter((row) => row.userId === options.userId);
    }
    rows.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
    if (options.limit && options.limit > 0) {
      return rows.slice(0, options.limit);
    }
    return rows;
  }

  async listActiveOverlays() {
    return [];
  }

  async recordOverlaySuccess() {
    throw new Error('not used');
  }

  async createRun() {}

  async finishRun() {}

  async listRuns() {
    return [];
  }

  async getRun() {
    return null;
  }

  async findUserByEmail() {
    return null;
  }

  async getUser() {
    return null;
  }

  async close() {}
}

function makeWatch(overrides: Partial<WatchDocument> = {}): WatchDocument {
  return {
    id: 'watch-1',
    userId: 'user-1',
    url: 'https://example.com/product',
    title: 'Demo Product',
    enabled: true,
    schedule: '0 9 * * *',
    lastPrice: null,
    lastCurrency: null,
    lastSource: null,
    lastCheckedAt: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('runWatch', () => {
  it('records baseline success and skips notification on first success', async () => {
    const store = new MemoryWatchStore();
    const watch = makeWatch();
    await store.upsertWatch(watch);
    const notifications: Array<Record<string, unknown>> = [];

    const check = await runWatch({
      watch,
      store: store as unknown as BillingStore,
      extractPrice: async () => ({
        price: 100,
        currency: 'INR',
        source: 'shopify_json',
        title: 'Demo Product',
      }),
      sendNtfy: async (payload) => {
        notifications.push(payload);
      },
      ntfy: { baseUrl: 'https://ntfy.sh', topic: 'billing', priority: 'default' },
      browserLoadHtml: async () => '<html></html>',
    });

    assert.equal(check.status, 'success');
    assert.equal(check.dropped, false);
    assert.equal(notifications.length, 0);

    const updated = await store.getWatch(watch.id);
    assert.equal(updated?.lastPrice, 100);
    assert.equal(updated?.lastCurrency, 'INR');
    assert.equal(updated?.lastSource, 'shopify_json');
    assert.ok(updated?.lastCheckedAt);
  });

  it('sends ntfy only when same source/currency price drops', async () => {
    const store = new MemoryWatchStore();
    const watch = makeWatch({
      lastPrice: 120,
      lastCurrency: 'INR',
      lastSource: 'shopify_json',
    });
    await store.upsertWatch(watch);
    const notifications: Array<Record<string, unknown>> = [];

    const check = await runWatch({
      watch,
      store: store as unknown as BillingStore,
      extractPrice: async () => ({
        price: 100,
        currency: 'INR',
        source: 'shopify_json',
      }),
      sendNtfy: async (payload) => {
        notifications.push(payload);
      },
      ntfy: { baseUrl: 'https://ntfy.sh', topic: 'billing', priority: 'default' },
      browserLoadHtml: async () => '<html></html>',
    });

    assert.equal(check.status, 'success');
    assert.equal(check.dropped, true);
    assert.equal(notifications.length, 1);
  });

  it('resets baseline on currency/source changes without notifying', async () => {
    const store = new MemoryWatchStore();
    const notifications: Array<Record<string, unknown>> = [];

    const currencyWatch = makeWatch({
      id: 'watch-currency',
      lastPrice: 120,
      lastCurrency: 'INR',
      lastSource: 'shopify_json',
    });
    await store.upsertWatch(currencyWatch);
    const currencyCheck = await runWatch({
      watch: currencyWatch,
      store: store as unknown as BillingStore,
      extractPrice: async () => ({
        price: 100,
        currency: 'USD',
        source: 'shopify_json',
      }),
      sendNtfy: async (payload) => {
        notifications.push(payload);
      },
      ntfy: { baseUrl: 'https://ntfy.sh', topic: 'billing', priority: 'default' },
      browserLoadHtml: async () => '<html></html>',
    });
    assert.equal(currencyCheck.dropped, false);
    assert.equal(notifications.length, 0);

    const sourceWatch = makeWatch({
      id: 'watch-source',
      lastPrice: 120,
      lastCurrency: 'INR',
      lastSource: 'json_ld',
    });
    await store.upsertWatch(sourceWatch);
    const sourceCheck = await runWatch({
      watch: sourceWatch,
      store: store as unknown as BillingStore,
      extractPrice: async () => ({
        price: 100,
        currency: 'INR',
        source: 'selector',
      }),
      sendNtfy: async (payload) => {
        notifications.push(payload);
      },
      ntfy: { baseUrl: 'https://ntfy.sh', topic: 'billing', priority: 'default' },
      browserLoadHtml: async () => '<html></html>',
    });
    assert.equal(sourceCheck.dropped, false);
    assert.equal(notifications.length, 0);
  });

  it('marks check failed on extract errors and keeps previous watch baseline', async () => {
    const store = new MemoryWatchStore();
    const watch = makeWatch({
      lastPrice: 120,
      lastCurrency: 'INR',
      lastSource: 'shopify_json',
      lastCheckedAt: '2026-08-11T00:00:00.000Z',
    });
    await store.upsertWatch(watch);

    const check = await runWatch({
      watch,
      store: store as unknown as BillingStore,
      extractPrice: async () => {
        throw new Error('network failed');
      },
      sendNtfy: async () => {},
      ntfy: { baseUrl: 'https://ntfy.sh', topic: 'billing', priority: 'default' },
      browserLoadHtml: async () => '<html></html>',
    });

    assert.equal(check.status, 'failed');
    assert.match(check.error ?? '', /network failed/i);

    const unchanged = await store.getWatch(watch.id);
    assert.equal(unchanged?.lastPrice, 120);
    assert.equal(unchanged?.lastCurrency, 'INR');
    assert.equal(unchanged?.lastSource, 'shopify_json');
    assert.equal(unchanged?.lastCheckedAt, '2026-08-11T00:00:00.000Z');
  });

  it('throws WatchBusyError when lock is already acquired', async () => {
    const store = new MemoryWatchStore();
    const watch = makeWatch({ id: 'watch-busy' });
    await store.upsertWatch(watch);

    tryAcquireWatchLock(watch.id);
    await assert.rejects(
      runWatch({
        watch,
        store: store as unknown as BillingStore,
        extractPrice: async () => ({
          price: 100,
          currency: 'INR',
          source: 'shopify_json',
        }),
        sendNtfy: async () => {},
        ntfy: { baseUrl: 'https://ntfy.sh', topic: 'billing', priority: 'default' },
        browserLoadHtml: async () => '<html></html>',
      }),
      (error: unknown) => error instanceof WatchBusyError,
    );
    releaseWatchLock(watch.id);
  });
});
