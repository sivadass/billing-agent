import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from './api-client';
import { listWatchChecks, listWatches, runWatchNow } from './watches-api';
import type { PriceCheckDocument, WatchDocument } from './types';

describe('watches API helpers', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8080');
    sessionStorage.setItem('billing-agent.jwt', 'jwt-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('lists watches from /watches', async () => {
    const watches: WatchDocument[] = [
      {
        id: 'watch-1',
        url: 'https://example.com/products/demo',
        title: 'Demo watch',
        enabled: true,
        schedule: '0 9 * * *',
        lastPrice: null,
        lastCurrency: null,
        lastSource: null,
        lastCheckedAt: null,
        createdAt: new Date().toISOString(),
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(watches), { status: 200 })));

    const result = await listWatches();
    expect(result).toEqual(watches);
  });

  it('posts check-now and returns check id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'check-1' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runWatchNow('watch-1');
    expect(result.id).toBe('check-1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/watches/watch-1/check');
  });

  it('lists checks with a limit filter', async () => {
    const checks: PriceCheckDocument[] = [
      {
        id: 'check-1',
        watchId: 'watch-1',
        status: 'success',
        price: 100,
        currency: 'INR',
        source: 'shopify_json',
        previousPrice: null,
        dropped: false,
        error: null,
        checkedAt: new Date().toISOString(),
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(checks), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listWatchChecks('watch-1', { limit: 10 });
    expect(result).toEqual(checks);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:8080/watches/watch-1/checks?limit=10',
    );
  });

  it('throws ApiClientError for check-now conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Watch already running' }), { status: 409 }),
      ),
    );

    await expect(runWatchNow('watch-1')).rejects.toEqual(
      expect.objectContaining({
        name: 'ApiClientError',
        kind: 'http',
        status: 409,
        message: 'Watch already running',
      }),
    );
    await expect(runWatchNow('watch-1')).rejects.toBeInstanceOf(ApiClientError);
  });
});
