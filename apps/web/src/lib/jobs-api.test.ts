import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from './api-client';
import { getJobSecrets, listJobs, runJobNow, updateJobSecrets } from './jobs-api';
import { listRuns } from './runs-api';
import type { JobDocument, RunDocument } from './types';

function canonicalJob(overrides: Partial<JobDocument> = {}): JobDocument {
  return {
    id: 'home-eb',
    name: 'Home EB bill',
    enabled: true,
    schedule: null,
    startUrl: 'https://www.tnebnet.org/awp/login',
    engine: 'adapter',
    adapterId: 'dummy',
    goal: 'Read the latest bill',
    schema: [],
    workflow: [],
    secretIds: [],
    notify: { title: 'Bill', on: 'always', channel: { type: 'ntfy', topic: 'bills' } },
    lastResult: null,
    createdAt: '2026-08-09T08:00:00.000Z',
    updatedAt: '2026-08-09T08:00:00.000Z',
    ...overrides,
  };
}

function canonicalRun(overrides: Partial<RunDocument> = {}): RunDocument {
  return {
    id: 'run-1',
    jobId: 'home-eb',
    engine: 'adapter',
    adapterId: 'dummy',
    status: 'success',
    startedAt: '2026-08-09T08:00:00.000Z',
    finishedAt: '2026-08-09T08:00:05.000Z',
    durationMs: 5000,
    errorCode: null,
    errorMessage: null,
    screenshotPath: null,
    recoveryAttempted: false,
    recoverySucceeded: false,
    overlayActivated: false,
    result: null,
    ...overrides,
  };
}

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
    const jobs: JobDocument[] = [canonicalJob()];
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

  it('reads which secret keys are set from /jobs/:id/secrets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ key: 'password', set: true }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const keys = await getJobSecrets('home-eb');
    expect(keys).toEqual([{ key: 'password', set: true }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/jobs/home-eb/secrets');
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET');
  });

  it('writes new secret values with PUT /jobs/:id/secrets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [
            { key: 'password', set: true },
            { key: 'username', set: true },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const keys = await updateJobSecrets('home-eb', { password: 'new-pass' });
    expect(keys).toEqual([
      { key: 'password', set: true },
      { key: 'username', set: true },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/jobs/home-eb/secrets');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ values: { password: 'new-pass' } });
  });

  it('surfaces a 409 from the secrets endpoint as an ApiClientError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Job already running' }), { status: 409 }),
      ),
    );

    await expect(updateJobSecrets('home-eb', { password: 'x' })).rejects.toEqual(
      expect.objectContaining({ name: 'ApiClientError', status: 409 }),
    );
  });

  it('lists runs with job and limit filters', async () => {
    const runs: RunDocument[] = [canonicalRun({ result: { amount: 1234.5 } })];
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
