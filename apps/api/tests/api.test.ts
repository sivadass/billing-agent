import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { BillingStore, JobDocument, RunDocument, SettingsDocument } from '@billing-agent/core';
import { startServer } from '../src/server.ts';

class MemoryStore implements BillingStore {
  settings: SettingsDocument = {
    id: 'default',
    ntfy: { baseUrl: 'https://ntfy.sh', topicEnv: 'NTFY_TOPIC', priority: 'default' },
    mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
    browser: { headless: true, timeoutMs: 60_000, saveErrorScreenshot: true },
    jobsGeneration: 0,
  };

  jobs = new Map<string, JobDocument>();
  runs = new Map<string, RunDocument>();

  async getSettings(): Promise<SettingsDocument> {
    return this.settings;
  }

  async listJobs(): Promise<JobDocument[]> {
    return [...this.jobs.values()];
  }

  async getJob(id: string): Promise<JobDocument | null> {
    return this.jobs.get(id) ?? null;
  }

  async upsertJob(job: JobDocument): Promise<void> {
    this.jobs.set(job.id, job);
  }

  async upsertSettings(settings: Omit<SettingsDocument, 'id'>): Promise<void> {
    this.settings = { id: 'default', ...settings };
  }

  async listActiveOverlays(): Promise<[]> {
    return [];
  }

  async recordOverlaySuccess(): Promise<never> {
    throw new Error('not implemented');
  }

  async createRun(run: RunDocument): Promise<void> {
    this.runs.set(run.id, run);
  }

  async finishRun(id: string, update: Partial<RunDocument>): Promise<void> {
    const current = this.runs.get(id);
    if (!current) return;
    this.runs.set(id, { ...current, ...update });
  }

  async listRuns(options?: { jobId?: string; limit?: number }): Promise<RunDocument[]> {
    let runs = [...this.runs.values()];
    if (options?.jobId) {
      runs = runs.filter((run) => run.jobId === options.jobId);
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (options?.limit && options.limit > 0) {
      return runs.slice(0, options.limit);
    }
    return runs;
  }

  async getRun(id: string): Promise<RunDocument | null> {
    return this.runs.get(id) ?? null;
  }

  async close(): Promise<void> {}
}

const handles: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (handles.length > 0) {
    await handles.pop()?.close();
  }
});

describe('api server', () => {
  it('returns 401 when bearer token is missing', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`);
    assert.equal(response.status, 401);
  });

  it('creates a job and then lists it', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
    });
    handles.push(handle);

    const created = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'smoke-test',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'Smoke' },
      }),
    });
    assert.equal(created.status, 201);

    const listResponse = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(listResponse.status, 200);
    const jobs = (await listResponse.json()) as JobDocument[];
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, 'smoke-test');
  });
});

describe('api CORS', () => {
  it('echoes Access-Control-Allow-Origin for an allowlisted Origin', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
      corsOrigins: ['http://localhost:5173'],
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(
      response.headers.get('access-control-allow-headers'),
      'Authorization, Content-Type',
    );
  });

  it('does not set CORS headers for a non-allowlisted Origin', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
      corsOrigins: ['http://localhost:5173'],
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('answers OPTIONS preflight with 204 before auth when CORS is configured', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
      corsOrigins: ['https://app.vercel.app'],
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.vercel.app');
    assert.match(response.headers.get('access-control-allow-methods') ?? '', /GET/);
  });

  it('does not short-circuit OPTIONS when corsOrigins is empty', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

describe('POST /jobs/:id/run', () => {
  const enabledJob: JobDocument = {
    id: 'home-eb',
    provider: 'dummy',
    enabled: true,
    schedule: null,
    credentialsEnv: {},
    notify: { title: 'Bill' },
  };

  it('returns 503 when onRunJob is not configured', async () => {
    const store = new MemoryStore();
    await store.upsertJob(enabledJob);
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store,
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 503);
  });

  it('returns 202 with run id from onRunJob', async () => {
    const store = new MemoryStore();
    await store.upsertJob(enabledJob);
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store,
      onRunJob: async () => 'run-123',
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 202);
    const body = (await response.json()) as { id: string };
    assert.equal(body.id, 'run-123');
  });

  it('returns 404 when job is missing', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
      onRunJob: async () => 'run-x',
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/missing/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 404);
  });

  it('returns 409 when job is disabled', async () => {
    const store = new MemoryStore();
    await store.upsertJob({ ...enabledJob, enabled: false });
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store,
      onRunJob: async () => 'run-x',
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 409);
  });

  it('returns 409 when a run is already running', async () => {
    const store = new MemoryStore();
    await store.upsertJob(enabledJob);
    await store.createRun({
      id: 'existing',
      jobId: 'home-eb',
      provider: 'dummy',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      screenshotPath: null,
      recoveryAttempted: false,
      recoverySucceeded: false,
      overlayActivated: false,
      billSummary: null,
    });
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store,
      onRunJob: async () => 'run-x',
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    });
    assert.equal(response.status, 409);
  });
});
