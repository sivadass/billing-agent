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

  async listRuns(): Promise<RunDocument[]> {
    return [...this.runs.values()];
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
