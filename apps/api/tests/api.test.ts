import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { hashPassword } from '@billing-agent/core';
import type {
  BillingStore,
  JobDocument,
  PriceCheckDocument,
  RunDocument,
  SettingsDocument,
  UserDocument,
  WatchDocument,
} from '@billing-agent/core';
import { startServer } from '../src/server.ts';

const JWT_SECRET = 'test-jwt-secret';

class MemoryStore implements BillingStore {
  settings: SettingsDocument = {
    id: 'default',
    ntfy: { baseUrl: 'https://ntfy.sh', topicEnv: 'NTFY_TOPIC', priority: 'default' },
    mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
    browser: { headless: true, timeoutMs: 60_000, saveErrorScreenshot: true },
    jobsGeneration: 0,
    watchesGeneration: 0,
  };

  jobs = new Map<string, JobDocument>();
  watches = new Map<string, WatchDocument>();
  priceChecks = new Map<string, PriceCheckDocument>();
  runs = new Map<string, RunDocument>();
  users = new Map<string, UserDocument>();

  async getSettings(): Promise<SettingsDocument> {
    return this.settings;
  }

  async listJobs(options?: { userId?: string }): Promise<JobDocument[]> {
    let jobs = [...this.jobs.values()];
    if (options?.userId) {
      jobs = jobs.filter((job) => job.userId === options.userId);
    }
    return jobs;
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

  async listWatches(options?: { userId?: string }): Promise<WatchDocument[]> {
    let watches = [...this.watches.values()];
    if (options?.userId) {
      watches = watches.filter((watch) => watch.userId === options.userId);
    }
    return watches;
  }

  async getWatch(id: string): Promise<WatchDocument | null> {
    return this.watches.get(id) ?? null;
  }

  async upsertWatch(watch: WatchDocument): Promise<void> {
    this.watches.set(watch.id, watch);
  }

  async deleteWatch(id: string): Promise<void> {
    this.watches.delete(id);
    for (const [checkId, check] of this.priceChecks.entries()) {
      if (check.watchId === id) {
        this.priceChecks.delete(checkId);
      }
    }
  }

  async createPriceCheck(check: PriceCheckDocument): Promise<void> {
    this.priceChecks.set(check.id, check);
  }

  async finishPriceCheck(id: string, update: Partial<PriceCheckDocument>): Promise<void> {
    const current = this.priceChecks.get(id);
    if (!current) return;
    this.priceChecks.set(id, { ...current, ...update });
  }

  async listPriceChecks(options: {
    watchId: string;
    userId?: string;
    limit?: number;
  }): Promise<PriceCheckDocument[]> {
    let checks = [...this.priceChecks.values()].filter((check) => check.watchId === options.watchId);
    if (options.userId) {
      checks = checks.filter((check) => check.userId === options.userId);
    }
    checks.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
    if (options.limit && options.limit > 0) {
      return checks.slice(0, options.limit);
    }
    return checks;
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

  async listRuns(options?: {
    userId?: string;
    jobId?: string;
    limit?: number;
  }): Promise<RunDocument[]> {
    let runs = [...this.runs.values()];
    if (options?.userId) {
      runs = runs.filter((run) => run.userId === options.userId);
    }
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

  async findUserByEmail(email: string): Promise<UserDocument | null> {
    const normalized = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === normalized) return user;
    }
    return null;
  }

  async getUser(id: string): Promise<UserDocument | null> {
    return this.users.get(id) ?? null;
  }

  async close(): Promise<void> {}
}

async function createUser(
  store: MemoryStore,
  email: string,
  password: string,
): Promise<UserDocument> {
  const user: UserDocument = {
    id: randomUUID(),
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  store.users.set(user.id, user);
  return user;
}

async function login(
  port: number,
  email: string,
  password: string,
): Promise<{ status: number; body: { token?: string; user?: { id: string; email: string }; error?: string } }> {
  const response = await fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await response.json() };
}

const handles: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (handles.length > 0) {
    await handles.pop()?.close();
  }
});

async function setupAuthedServer(options?: {
  store?: MemoryStore;
  onRunJob?: (jobId: string) => Promise<string>;
  onRunWatch?: (watchId: string) => Promise<string>;
  corsOrigins?: string[];
}): Promise<{
  handle: { port: number; close: () => Promise<void> };
  store: MemoryStore;
  user: UserDocument;
  token: string;
}> {
  const store = options?.store ?? new MemoryStore();
  const user = await createUser(store, 'owner@example.com', 'correct-password');
  const handle = await startServer({
    port: 0,
    jwtSecret: JWT_SECRET,
    store,
    onRunJob: options?.onRunJob,
    onRunWatch: options?.onRunWatch,
    corsOrigins: options?.corsOrigins,
  });
  handles.push(handle);

  const loginResult = await login(handle.port, user.email, 'correct-password');
  assert.equal(loginResult.status, 200);
  const token = loginResult.body.token;
  if (!token) throw new Error('login did not return a token');

  return { handle, store, user, token };
}

describe('POST /auth/login', () => {
  it('returns a token and user for correct credentials', async () => {
    const store = new MemoryStore();
    const user = await createUser(store, 'login@example.com', 'good-password');
    const handle = await startServer({ port: 0, jwtSecret: JWT_SECRET, store });
    handles.push(handle);

    const result = await login(handle.port, user.email, 'good-password');
    assert.equal(result.status, 200);
    assert.equal(typeof result.body.token, 'string');
    assert.deepEqual(result.body.user, { id: user.id, email: user.email });
  });

  it('returns a generic 401 for wrong password', async () => {
    const store = new MemoryStore();
    const user = await createUser(store, 'login2@example.com', 'good-password');
    const handle = await startServer({ port: 0, jwtSecret: JWT_SECRET, store });
    handles.push(handle);

    const result = await login(handle.port, user.email, 'wrong-password');
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Invalid email or password' });
  });

  it('returns a generic 401 for unknown email', async () => {
    const store = new MemoryStore();
    const handle = await startServer({ port: 0, jwtSecret: JWT_SECRET, store });
    handles.push(handle);

    const result = await login(handle.port, 'nobody@example.com', 'whatever');
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Invalid email or password' });
  });

  it('matches email case-insensitively', async () => {
    const store = new MemoryStore();
    const user = await createUser(store, 'CaseSensitive@Example.com', 'good-password');
    const handle = await startServer({ port: 0, jwtSecret: JWT_SECRET, store });
    handles.push(handle);

    const result = await login(handle.port, 'CASESENSITIVE@EXAMPLE.COM', 'good-password');
    assert.equal(result.status, 200);
    assert.equal(result.body.user?.email, user.email);
  });
});

describe('api server', () => {
  it('returns 401 when bearer token is missing', async () => {
    const { handle } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
  });

  it('returns 401 for an invalid JWT', async () => {
    const { handle } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(response.status, 401);
  });

  it('creates a job and then lists it, stamping the caller userId', async () => {
    const { handle, user, token } = await setupAuthedServer();

    const created = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
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
    const createdJob = (await created.json()) as JobDocument;
    assert.equal(createdJob.userId, user.id);

    const listResponse = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listResponse.status, 200);
    const jobs = (await listResponse.json()) as JobDocument[];
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, 'smoke-test');
    assert.equal(jobs[0]?.userId, user.id);
  });

  it('ignores a client-supplied userId when creating a job', async () => {
    const { handle, user, token } = await setupAuthedServer();

    const created = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'spoofed-owner',
        userId: 'someone-else',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'Spoofed' },
      }),
    });
    assert.equal(created.status, 201);
    const createdJob = (await created.json()) as JobDocument;
    assert.equal(createdJob.userId, user.id);
  });
});

describe('cross-user isolation', () => {
  it('returns 404 when a different user tries to GET a job they do not own', async () => {
    const store = new MemoryStore();
    const { handle, token: tokenA } = await setupAuthedServer({ store });
    const userB = await createUser(store, 'userb@example.com', 'password-b');
    const loginB = await login(handle.port, userB.email, 'password-b');
    const tokenB = loginB.body.token;
    if (!tokenB) throw new Error('login for user B failed');

    const created = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'a-only-job',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'A only' },
      }),
    });
    assert.equal(created.status, 201);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/a-only-job`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(response.status, 404);
  });

  it('excludes another user job from GET /jobs listing', async () => {
    const store = new MemoryStore();
    const { handle, token: tokenA } = await setupAuthedServer({ store });
    const userB = await createUser(store, 'userc@example.com', 'password-c');
    const loginB = await login(handle.port, userB.email, 'password-c');
    const tokenB = loginB.body.token;
    if (!tokenB) throw new Error('login for user B failed');

    await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'a-only-job-2',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'A only 2' },
      }),
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(response.status, 200);
    const jobs = (await response.json()) as JobDocument[];
    assert.equal(jobs.length, 0);
  });

  it('returns 404 when a different user tries to PATCH a job they do not own', async () => {
    const store = new MemoryStore();
    const { handle, token: tokenA } = await setupAuthedServer({ store });
    const userB = await createUser(store, 'userd@example.com', 'password-d');
    const loginB = await login(handle.port, userB.email, 'password-d');
    const tokenB = loginB.body.token;
    if (!tokenB) throw new Error('login for user B failed');

    await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'a-only-job-3',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'A only 3' },
      }),
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/a-only-job-3`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(response.status, 404);
  });

  it('returns 404 when a different user tries to DELETE a job they do not own', async () => {
    const store = new MemoryStore();
    const { handle, token: tokenA } = await setupAuthedServer({ store });
    const userB = await createUser(store, 'usere@example.com', 'password-e');
    const loginB = await login(handle.port, userB.email, 'password-e');
    const tokenB = loginB.body.token;
    if (!tokenB) throw new Error('login for user B failed');

    await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'a-only-job-4',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'A only 4' },
      }),
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/a-only-job-4`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(response.status, 404);
  });

  it('returns 404 when a different user tries to run a job they do not own', async () => {
    const store = new MemoryStore();
    const { handle, token: tokenA } = await setupAuthedServer({
      store,
      onRunJob: async () => 'run-x',
    });
    const userB = await createUser(store, 'userf@example.com', 'password-f');
    const loginB = await login(handle.port, userB.email, 'password-f');
    const tokenB = loginB.body.token;
    if (!tokenB) throw new Error('login for user B failed');

    await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'a-only-job-5',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'A only 5' },
      }),
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/a-only-job-5/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(response.status, 404);
  });

  it('returns 404 when a different user tries to GET a run they do not own', async () => {
    const store = new MemoryStore();
    const { handle, user: userA, token: tokenA } = await setupAuthedServer({ store });
    const userB = await createUser(store, 'userg@example.com', 'password-g');
    const loginB = await login(handle.port, userB.email, 'password-g');
    const tokenB = loginB.body.token;
    if (!tokenB) throw new Error('login for user B failed');

    await store.createRun({
      id: 'a-only-run',
      jobId: 'a-only-job',
      userId: userA.id,
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
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/runs/a-only-run`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(response.status, 404);

    const ownResponse = await fetch(`http://127.0.0.1:${handle.port}/runs/a-only-run`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(ownResponse.status, 200);
  });
});

describe('api CORS', () => {
  it('echoes Access-Control-Allow-Origin for an allowlisted Origin', async () => {
    const handle = await startServer({
      port: 0,
      jwtSecret: JWT_SECRET,
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
      jwtSecret: JWT_SECRET,
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
      jwtSecret: JWT_SECRET,
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
      jwtSecret: JWT_SECRET,
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
  function enabledJobFor(userId: string): JobDocument {
    return {
      id: 'home-eb',
      userId,
      provider: 'dummy',
      enabled: true,
      schedule: null,
      credentialsEnv: {},
      notify: { title: 'Bill' },
    };
  }

  it('returns 503 when onRunJob is not configured', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    await store.upsertJob(enabledJobFor(user.id));

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 503);
  });

  it('returns 202 with run id from onRunJob', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({
      store,
      onRunJob: async () => 'run-123',
    });
    await store.upsertJob(enabledJobFor(user.id));

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 202);
    const body = (await response.json()) as { id: string };
    assert.equal(body.id, 'run-123');
  });

  it('returns 404 when job is missing', async () => {
    const { handle, token } = await setupAuthedServer({
      onRunJob: async () => 'run-x',
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/missing/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 404);
  });

  it('returns 409 when job is disabled', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({
      store,
      onRunJob: async () => 'run-x',
    });
    await store.upsertJob({ ...enabledJobFor(user.id), enabled: false });

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 409);
  });

  it('returns 409 when a run is already running', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({
      store,
      onRunJob: async () => 'run-x',
    });
    await store.upsertJob(enabledJobFor(user.id));
    await store.createRun({
      id: 'existing',
      jobId: 'home-eb',
      userId: user.id,
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

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 409);
  });
});

describe('watches api', () => {
  function buildWatchPayload() {
    return {
      id: 'watch-home',
      url: 'https://example.com/products/demo',
      title: 'Demo watch',
      enabled: true,
      schedule: '0 9 * * *',
    };
  }

  it('creates a watch and lists it for the owner', async () => {
    const { handle, user, token } = await setupAuthedServer();
    const created = await fetch(`http://127.0.0.1:${handle.port}/watches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...buildWatchPayload(), userId: 'spoofed' }),
    });
    assert.equal(created.status, 201);
    const watch = (await created.json()) as WatchDocument;
    assert.equal(watch.userId, user.id);
    assert.equal(watch.schedule, '0 9 * * *');
    assert.equal(watch.lastPrice, null);

    const listed = await fetch(`http://127.0.0.1:${handle.port}/watches`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(listed.status, 200);
    const watches = (await listed.json()) as WatchDocument[];
    assert.equal(watches.length, 1);
    assert.equal(watches[0]?.id, watch.id);
  });

  it('rejects non-public watch urls with 400', async () => {
    const { handle, token } = await setupAuthedServer();
    const response = await fetch(`http://127.0.0.1:${handle.port}/watches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'watch-localhost',
        url: 'http://localhost:3000/private',
      }),
    });
    assert.equal(response.status, 400);
  });

  it('returns 404 when another user requests a watch they do not own', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    const otherUser = await createUser(store, 'watch-other@example.com', 'other-password');
    const loginOther = await login(handle.port, otherUser.email, 'other-password');
    const otherToken = loginOther.body.token;
    if (!otherToken) throw new Error('other user login failed');

    await store.upsertWatch({
      ...buildWatchPayload(),
      id: 'watch-owner-only',
      userId: user.id,
      createdAt: new Date().toISOString(),
      lastPrice: null,
      lastCurrency: null,
      lastSource: null,
      lastCheckedAt: null,
    });

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/watches/watch-owner-only`,
      {
        headers: { Authorization: `Bearer ${otherToken}` },
      },
    );
    assert.equal(response.status, 404);
  });

  it('check-now returns 202 when onRunWatch reports a check id', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({
      store,
      onRunWatch: async () => 'check-123',
    });
    await store.upsertWatch({
      ...buildWatchPayload(),
      id: 'watch-202',
      userId: user.id,
      createdAt: new Date().toISOString(),
      lastPrice: null,
      lastCurrency: null,
      lastSource: null,
      lastCheckedAt: null,
      enabled: false,
    });

    const response = await fetch(`http://127.0.0.1:${handle.port}/watches/watch-202/check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { id: 'check-123' });
  });

  it('check-now returns 409 when a watch already has a running check', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({
      store,
      onRunWatch: async () => 'check-x',
    });
    await store.upsertWatch({
      ...buildWatchPayload(),
      id: 'watch-running',
      userId: user.id,
      createdAt: new Date().toISOString(),
      lastPrice: null,
      lastCurrency: null,
      lastSource: null,
      lastCheckedAt: null,
    });
    await store.createPriceCheck({
      id: 'check-running',
      watchId: 'watch-running',
      userId: user.id,
      status: 'running',
      price: null,
      currency: null,
      source: null,
      previousPrice: null,
      dropped: null,
      error: null,
      checkedAt: new Date().toISOString(),
    });

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/watches/watch-running/check`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Watch already running' });
  });

  it('delete watch cascades checks and bumps watchesGeneration', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    await store.upsertWatch({
      ...buildWatchPayload(),
      id: 'watch-delete',
      userId: user.id,
      createdAt: new Date().toISOString(),
      lastPrice: null,
      lastCurrency: null,
      lastSource: null,
      lastCheckedAt: null,
    });
    await store.createPriceCheck({
      id: 'check-delete',
      watchId: 'watch-delete',
      userId: user.id,
      status: 'success',
      price: 100,
      currency: 'INR',
      source: 'shopify_json',
      previousPrice: null,
      dropped: false,
      error: null,
      checkedAt: new Date().toISOString(),
    });

    const before = store.settings.watchesGeneration;
    const deleted = await fetch(`http://127.0.0.1:${handle.port}/watches/watch-delete`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(deleted.status, 200);

    assert.equal(await store.getWatch('watch-delete'), null);
    const checks = await store.listPriceChecks({ watchId: 'watch-delete', userId: user.id });
    assert.equal(checks.length, 0);
    assert.equal(store.settings.watchesGeneration, before + 1);
  });
});
