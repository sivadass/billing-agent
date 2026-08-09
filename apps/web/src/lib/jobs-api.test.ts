import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from './api-client';
import { listJobs, runJobNow } from './jobs-api';
import { listRuns } from './runs-api';
import type { JobDocument, RunDocument } from './types';

describe('jobs and runs API helpers', () => {
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

  it('lists jobs from /jobs', async () => {
    const jobs: JobDocument[] = [
      {
        id: 'home-eb',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'Bill' },
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(jobs), { status: 200 })));

    const result = await listJobs();
    expect(result).toEqual(jobs);
  });

  it('posts to /jobs/:id/run and returns id on 202', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'run-1' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runJobNow('home-eb');
    expect(result.id).toBe('run-1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/jobs/home-eb/run');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('throws ApiClientError with API error message on non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Job already running' }), { status: 409 }),
      ),
    );

    await expect(runJobNow('home-eb')).rejects.toEqual(
      expect.objectContaining({
        name: 'ApiClientError',
        kind: 'http',
        status: 409,
        message: 'Job already running',
      }),
    );
  });

  it('lists runs with job and limit filters', async () => {
    const runs: RunDocument[] = [
      {
        id: 'run-1',
        jobId: 'home-eb',
        provider: 'dummy',
        status: 'success',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 100,
        errorCode: null,
        errorMessage: null,
        screenshotPath: null,
        recoveryAttempted: false,
        recoverySucceeded: false,
        overlayActivated: false,
        billSummary: null,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(runs), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listRuns({ jobId: 'home-eb', limit: 10 });
    expect(result).toEqual(runs);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/runs?jobId=home-eb&limit=10');
  });

  it('throws ApiClientError type when run lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Run not found' }), { status: 404 })),
    );

    await expect(listRuns({ jobId: 'missing' })).rejects.toBeInstanceOf(ApiClientError);
  });
});
