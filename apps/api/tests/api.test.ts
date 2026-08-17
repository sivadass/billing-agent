import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import {
  createBrowserLock,
  decryptSecret,
  hashPassword,
  parseMasterKey,
} from '@billing-agent/core';
import type {
  BillingStore,
  BrowserLock,
  JobDocument,
  PriceCheckDocument,
  RunDocument,
  SecretDocument,
  SettingsDocument,
  UserDocument,
  WatchDocument,
} from '@billing-agent/core';
import { startServer } from '../src/server.ts';

const JWT_SECRET = 'test-jwt-secret';
const MASTER_KEY_HEX = '11'.repeat(32);
const TEST_ENV: NodeJS.ProcessEnv = { SECRETS_MASTER_KEY: MASTER_KEY_HEX };

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
  secrets = new Map<string, SecretDocument>();
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

  async upsertSecret(secret: SecretDocument): Promise<void> {
    this.secrets.set(secret.id, secret);
  }

  async listSecrets(options: {
    userId: string;
    jobId?: string;
    conversationId?: string;
  }): Promise<SecretDocument[]> {
    let secrets = [...this.secrets.values()].filter(
      (secret) => secret.userId === options.userId,
    );
    if (options.jobId !== undefined) {
      secrets = secrets.filter((secret) => secret.jobId === options.jobId);
    }
    if (options.conversationId !== undefined) {
      secrets = secrets.filter(
        (secret) => secret.conversationId === options.conversationId,
      );
    }
    return secrets.sort((a, b) => a.key.localeCompare(b.key));
  }

  async deleteSecretsForJob(jobId: string): Promise<void> {
    for (const [id, secret] of this.secrets.entries()) {
      if (secret.jobId === jobId) {
        this.secrets.delete(id);
      }
    }
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

function canonicalAdapterJob(overrides: Partial<JobDocument> = {}): JobDocument {
  const now = new Date().toISOString();
  return {
    id: 'home-eb',
    userId: 'unset',
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function canonicalJobPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
    ...overrides,
  };
}

function canonicalRun(overrides: Partial<RunDocument> = {}): RunDocument {
  return {
    id: 'run-1',
    jobId: 'home-eb',
    userId: 'unset',
    engine: 'adapter',
    adapterId: 'dummy',
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
    result: null,
    ...overrides,
  };
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
  env?: NodeJS.ProcessEnv;
  lock?: BrowserLock;
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
    env: options?.env ?? TEST_ENV,
    lock: options?.lock,
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
      body: JSON.stringify(
        canonicalJobPayload({ id: 'smoke-test', name: 'Smoke', notify: { title: 'Smoke', on: 'always', channel: { type: 'ntfy', topic: 'bills' } } }),
      ),
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
      body: JSON.stringify(
        canonicalJobPayload({ id: 'spoofed-owner', userId: 'someone-else' }),
      ),
    });
    assert.equal(created.status, 201);
    const createdJob = (await created.json()) as JobDocument;
    assert.equal(createdJob.userId, user.id);
  });
});

describe('POST /jobs canonical shape', () => {
  it('accepts a canonical adapter job and stores the canonical fields', async () => {
    const { handle, store, user, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({
          id: 'tnebnet-org-a1b2',
          adapterId: 'tnpdcl',
          schema: [{ key: 'amount', label: 'Amount', type: 'price' }],
          notify: {
            title: 'EB bill',
            on: 'change',
            channel: { type: 'ntfy', topic: 'bills' },
          },
        }),
      ),
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument & Record<string, unknown>;
    assert.equal(created.engine, 'adapter');
    assert.equal(created.adapterId, 'tnpdcl');
    assert.equal(created.userId, user.id);
    assert.equal(created.startUrl, 'https://www.tnebnet.org/awp/login');
    assert.deepEqual(created.schema, [{ key: 'amount', label: 'Amount', type: 'price' }]);
    assert.deepEqual(created.notify, {
      title: 'EB bill',
      on: 'change',
      channel: { type: 'ntfy', topic: 'bills' },
    });
    assert.equal('provider' in created, false);
    assert.equal('credentialsEnv' in created, false);

    const stored = await store.getJob('tnebnet-org-a1b2');
    assert.equal(stored?.engine, 'adapter');
    assert.equal(stored?.adapterId, 'tnpdcl');
  });

  it('accepts a canonical workflow job with workflow steps', async () => {
    const { handle, store, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({
          id: 'sivadass-in-b2c3',
          engine: 'workflow',
          adapterId: undefined,
          startUrl: 'https://sivadass.in/',
          workflow: [
            { id: 's1', type: 'goto', url: 'https://sivadass.in/' },
            {
              id: 's2',
              type: 'extract',
              fields: [{ key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' }],
            },
          ],
        }),
      ),
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.equal(created.engine, 'workflow');
    assert.equal(created.workflow.length, 2);
    assert.equal(created.adapterId, undefined);

    const stored = await store.getJob('sivadass-in-b2c3');
    assert.equal(stored?.workflow.length, 2);
  });

  it('returns 400 for an unknown engine', async () => {
    const { handle, store, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(canonicalJobPayload({ id: 'bad-engine', engine: 'magic' })),
    });

    assert.equal(response.status, 400);
    assert.equal(await store.getJob('bad-engine'), null);
  });

  it('returns 400 for a malformed engine value', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(canonicalJobPayload({ id: 'bad-engine-2', engine: 7 })),
    });

    assert.equal(response.status, 400);
  });

  it('returns 400 when an adapter job has no adapterId', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({ id: 'no-adapter', adapterId: undefined }),
      ),
    });

    assert.equal(response.status, 400);
  });

  it('returns 400 for a job id containing a path separator', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(canonicalJobPayload({ id: 'home-eb/secrets' })),
    });

    assert.equal(response.status, 400);
  });

  it('returns 400 for a malformed workflow step', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({
          id: 'bad-workflow',
          engine: 'workflow',
          adapterId: undefined,
          workflow: [{ id: 's1', type: 'teleport', url: 'https://sivadass.in/' }],
        }),
      ),
    });

    assert.equal(response.status, 400);
  });

  // Write-time validation shares `validateWorkflow` with the interpreter, so
  // every workflow the runner would refuse to execute is a 400 here instead of
  // a job that fails on its first scheduled tick.
  it('returns 400 for every workflow the interpreter would refuse to run', async () => {
    const { handle, store, token } = await setupAuthedServer();
    const extract = {
      id: 'read-email',
      type: 'extract',
      fields: [{ key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' }],
    };
    const cases: Array<[string, unknown]> = [
      ['goto protocol', [{ id: 'g', type: 'goto', url: 'javascript:alert(1)' }, extract]],
      ['goto private host', [{ id: 'g', type: 'goto', url: 'http://127.0.0.1/' }, extract]],
      ['goto relative url', [{ id: 'g', type: 'goto', url: '/products' }, extract]],
      ['goto file authority', [{ id: 'g', type: 'goto', url: 'file://evil.example/x' }, extract]],
      [
        'fill secret without secretKey',
        [{ id: 'f', type: 'fill', selector: '#p', source: 'secret' }, extract],
      ],
      [
        'fill literal without value',
        [{ id: 'f', type: 'fill', selector: '#p', source: 'literal' }, extract],
      ],
      [
        'fill with an unknown source',
        [{ id: 'f', type: 'fill', selector: '#p', source: 'env', value: 'X' }, extract],
      ],
      ['wait with neither selector nor timeout', [{ id: 'w', type: 'wait' }, extract]],
      ['wait timeout zero', [{ id: 'w', type: 'wait', timeoutMs: 0 }, extract]],
      [
        'wait timeout beyond the cap',
        [{ id: 'w', type: 'wait', timeoutMs: 10_000_000 }, extract],
      ],
      ['empty extract fields', [{ id: 'e', type: 'extract', fields: [] }]],
      [
        'text strategy without a selector',
        [{ id: 'e', type: 'extract', fields: [{ key: 'email', strategy: 'text' }] }],
      ],
      [
        'duplicate step ids',
        [
          { id: 'same', type: 'goto', url: 'https://sivadass.in/' },
          { ...extract, id: 'same' },
        ],
      ],
      [
        'unknown step property',
        [{ id: 's', type: 'click', selector: '#a', script: 'alert(1)' }, extract],
      ],
    ];

    for (const [label, workflow] of cases) {
      const id = `bad-${label.replace(/[^a-z0-9]+/gi, '-')}`;
      const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          canonicalJobPayload({
            id,
            engine: 'workflow',
            adapterId: undefined,
            startUrl: 'https://sivadass.in/',
            workflow,
          }),
        ),
      });

      assert.equal(response.status, 400, label);
      assert.equal(await store.getJob(id), null, label);
    }
  });

  it('returns 400 for a workflow job with no extract step to replay', async () => {
    const { handle, store, token } = await setupAuthedServer();

    for (const [label, workflow] of [
      ['empty', []],
      ['navigation only', [{ id: 'g', type: 'goto', url: 'https://sivadass.in/' }]],
    ] as Array<[string, unknown]>) {
      const id = `no-extract-${label.replace(/\s+/g, '-')}`;
      const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          canonicalJobPayload({
            id,
            engine: 'workflow',
            adapterId: undefined,
            startUrl: 'https://sivadass.in/',
            workflow,
          }),
        ),
      });

      assert.equal(response.status, 400, label);
      assert.equal(await store.getJob(id), null, label);
    }
  });

  it('accepts the workflow shape a migrated watch job carries', async () => {
    const { handle, store, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({
          id: 'craftandglory-in-a1b2',
          engine: 'workflow',
          adapterId: undefined,
          startUrl: 'https://craftandglory.in/products/sneakers',
          schema: [
            { key: 'price', label: 'Price', type: 'price' },
            { key: 'currency', label: 'Currency', type: 'string' },
          ],
          workflow: [
            {
              id: 'goto-watch',
              type: 'goto',
              url: 'https://craftandglory.in/products/sneakers',
            },
            {
              id: 'extract-price',
              type: 'extract',
              fields: [
                { key: 'price', strategy: 'shopify_json' },
                { key: 'currency', strategy: 'shopify_json' },
                { key: 'price', strategy: 'price' },
              ],
            },
          ],
        }),
      ),
    });

    assert.equal(response.status, 201);
    const stored = await store.getJob('craftandglory-in-a1b2');
    assert.equal(stored?.workflow.length, 2);
  });

  it('keeps accepting an adapter job with an empty workflow', async () => {
    const { handle, store, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(canonicalJobPayload({ id: 'adapter-empty-workflow' })),
    });

    assert.equal(response.status, 201);
    assert.deepEqual((await store.getJob('adapter-empty-workflow'))?.workflow, []);
  });

  it('keeps accepting a legacy provider payload as an adapter job', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'legacy-shape',
        provider: 'dummy',
        enabled: true,
        schedule: null,
        credentialsEnv: {},
        notify: { title: 'Legacy' },
      }),
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument & Record<string, unknown>;
    assert.equal(created.engine, 'adapter');
    assert.equal(created.adapterId, 'dummy');
    assert.equal('provider' in created, false);
    assert.equal('credentialsEnv' in created, false);
  });

  it('PATCH keeps the canonical shape and rejects a bad engine with 400', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    await store.upsertJob(canonicalAdapterJob({ userId: user.id }));

    const patched = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: false, notify: { title: 'Renamed', on: 'failure_only' } }),
    });
    assert.equal(patched.status, 200);
    const job = (await patched.json()) as JobDocument & Record<string, unknown>;
    assert.equal(job.enabled, false);
    assert.equal(job.notify.title, 'Renamed');
    assert.equal(job.notify.on, 'failure_only');
    assert.equal(job.engine, 'adapter');
    assert.equal('provider' in job, false);

    const rejected = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ engine: 'magic' }),
    });
    assert.equal(rejected.status, 400);
  });
});

describe('POST /jobs rejects malformed supplied values', () => {
  async function postJob(
    port: number,
    token: string,
    overrides: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(canonicalJobPayload(overrides)),
    });
  }

  const malformed: Array<[string, Record<string, unknown>]> = [
    ['a non-boolean enabled', { enabled: 'yes' }],
    ['a non-string, non-null schedule', { schedule: 5 }],
    ['a non-string adapterId', { adapterId: 7 }],
    ['a non-string name', { name: 12 }],
    ['a non-string goal', { goal: false }],
    ['a non-object notify', { notify: 'Bill' }],
    [
      'an unknown notify.on',
      {
        notify: { title: 'Bill', on: 'sometimes', channel: { type: 'ntfy', topic: 'bills' } },
      },
    ],
    [
      'a non-string notify.on',
      { notify: { title: 'Bill', on: 5, channel: { type: 'ntfy', topic: 'bills' } } },
    ],
    [
      'a non-string notify.title',
      { notify: { title: 9, on: 'always', channel: { type: 'ntfy', topic: 'bills' } } },
    ],
    [
      'an unknown notify.channel type',
      { notify: { title: 'Bill', on: 'always', channel: { type: 'carrier-pigeon' } } },
    ],
    [
      'a webhook channel without a url',
      { notify: { title: 'Bill', on: 'always', channel: { type: 'webhook' } } },
    ],
    [
      'a webhook channel with an empty url',
      { notify: { title: 'Bill', on: 'always', channel: { type: 'webhook', url: '' } } },
    ],
    [
      'a non-string ntfy topic',
      { notify: { title: 'Bill', on: 'always', channel: { type: 'ntfy', topic: 42 } } },
    ],
    [
      'a non-string ntfy baseUrl',
      {
        notify: {
          title: 'Bill',
          on: 'always',
          channel: { type: 'ntfy', topic: 'bills', baseUrl: 7 },
        },
      },
    ],
  ];

  for (const [label, overrides] of malformed) {
    it(`returns 400 for ${label}`, async () => {
      const store = new MemoryStore();
      const { handle, token } = await setupAuthedServer({ store });

      const response = await postJob(handle.port, token, {
        id: 'malformed',
        ...overrides,
      });

      assert.equal(response.status, 400);
      assert.equal(await store.getJob('malformed'), null);
    });
  }

  it('still fills omitted notify fields from the defaults', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'partial-notify',
        engine: 'adapter',
        adapterId: 'dummy',
        notify: { title: 'Only a title' },
      }),
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.equal(created.name, 'Only a title');
    assert.deepEqual(created.notify, {
      title: 'Only a title',
      on: 'always',
      channel: { type: 'ntfy', topic: '' },
    });
  });

  it('returns a fixed 400 for a malformed JSON body', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{"id": "broken",',
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid request body' });
  });
});

describe('job URLs must pass the public-url check', () => {
  const blockedUrls = [
    'http://localhost:3000/private',
    'http://127.0.0.1:8080/admin',
    'http://10.1.2.3/internal',
    'http://169.254.169.254/latest/meta-data/',
    'https://printer.local/status',
    'https://vault.internal/secret',
    'https://user:pass@example.com/bill',
    'file:///etc/passwd',
    'not-a-url',
  ];

  for (const url of blockedUrls) {
    it(`rejects startUrl ${url} with 400`, async () => {
      const store = new MemoryStore();
      const { handle, token } = await setupAuthedServer({ store });

      const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(canonicalJobPayload({ id: 'ssrf', startUrl: url })),
      });

      assert.equal(response.status, 400);
      assert.equal(await store.getJob('ssrf'), null);
    });

    it(`rejects an ntfy notify channel whose baseUrl is ${url} with 400`, async () => {
      const store = new MemoryStore();
      const { handle, token } = await setupAuthedServer({ store });

      const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          canonicalJobPayload({
            id: 'ssrf-ntfy',
            notify: {
              title: 'Bill',
              on: 'always',
              channel: { type: 'ntfy', topic: 'bills', baseUrl: url },
            },
          }),
        ),
      });

      assert.equal(response.status, 400);
      assert.equal(await store.getJob('ssrf-ntfy'), null);
    });

    it(`rejects a PATCH moving the ntfy baseUrl to ${url}`, async () => {
      const store = new MemoryStore();
      const { handle, user, token } = await setupAuthedServer({ store });
      const original = canonicalAdapterJob({ userId: user.id });
      await store.upsertJob(original);

      const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          notify: { channel: { type: 'ntfy', topic: 'bills', baseUrl: url } },
        }),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await store.getJob('home-eb'), original);
    });

    it(`rejects a webhook notify channel pointing at ${url} with 400`, async () => {
      const store = new MemoryStore();
      const { handle, token } = await setupAuthedServer({ store });

      const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          canonicalJobPayload({
            id: 'ssrf-webhook',
            notify: { title: 'Bill', on: 'always', channel: { type: 'webhook', url } },
          }),
        ),
      });

      assert.equal(response.status, 400);
      assert.equal(await store.getJob('ssrf-webhook'), null);
    });
  }

  it('accepts a public ntfy baseUrl', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({
          id: 'public-ntfy',
          notify: {
            title: 'Bill',
            on: 'always',
            channel: {
              type: 'ntfy',
              topic: 'bills',
              baseUrl: 'https://ntfy.example.com',
            },
          },
        }),
      ),
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.deepEqual(created.notify.channel, {
      type: 'ntfy',
      topic: 'bills',
      baseUrl: 'https://ntfy.example.com',
    });
  });

  it('accepts an ntfy channel that omits baseUrl', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({
          id: 'default-ntfy',
          notify: {
            title: 'Bill',
            on: 'always',
            channel: { type: 'ntfy', topic: 'bills' },
          },
        }),
      ),
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.deepEqual(created.notify.channel, { type: 'ntfy', topic: 'bills' });
  });

  it('accepts a public https webhook channel', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({
          id: 'public-webhook',
          notify: {
            title: 'Bill',
            on: 'always',
            channel: { type: 'webhook', url: 'https://hooks.example.com/bill' },
          },
        }),
      ),
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.deepEqual(created.notify.channel, {
      type: 'webhook',
      url: 'https://hooks.example.com/bill',
    });
  });
});

describe('startUrl is required where the engine needs it', () => {
  /** Minimal workflow that passes validation: navigate, then extract something. */
  const replayableWorkflow = [
    { id: 'open', type: 'goto', url: 'https://sivadass.in/' },
    {
      id: 'read-price',
      type: 'extract',
      fields: [{ key: 'price', selector: '.price', strategy: 'text' }],
    },
  ];

  async function postWorkflowJob(
    port: number,
    token: string,
    overrides: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'flow',
        engine: 'workflow',
        name: 'Flow',
        goal: 'Read the price',
        workflow: replayableWorkflow,
        notify: { title: 'Flow', on: 'always', channel: { type: 'ntfy', topic: 'flow' } },
        ...overrides,
      }),
    });
  }

  it('returns 400 when a workflow job omits startUrl', async () => {
    const store = new MemoryStore();
    const { handle, token } = await setupAuthedServer({ store });

    const response = await postWorkflowJob(handle.port, token, {});

    assert.equal(response.status, 400);
    assert.equal(await store.getJob('flow'), null);
  });

  it('returns 400 when a workflow job sends an empty startUrl', async () => {
    const store = new MemoryStore();
    const { handle, token } = await setupAuthedServer({ store });

    const response = await postWorkflowJob(handle.port, token, { startUrl: '' });

    assert.equal(response.status, 400);
    assert.equal(await store.getJob('flow'), null);
  });

  it('returns 400 when a workflow job sends a private startUrl', async () => {
    const store = new MemoryStore();
    const { handle, token } = await setupAuthedServer({ store });

    const response = await postWorkflowJob(handle.port, token, {
      startUrl: 'http://127.0.0.1:9000/flow',
    });

    assert.equal(response.status, 400);
    assert.equal(await store.getJob('flow'), null);
  });

  it('creates a workflow job with a public startUrl', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await postWorkflowJob(handle.port, token, {
      startUrl: 'https://sivadass.in/',
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.equal(created.engine, 'workflow');
    assert.equal(created.startUrl, 'https://sivadass.in/');
  });

  it('rejects a PATCH switching an adapter job to workflow without a startUrl', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    const original = canonicalAdapterJob({ userId: user.id, startUrl: '' });
    await store.upsertJob(original);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        engine: 'workflow',
        workflow: replayableWorkflow,
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await store.getJob('home-eb'), original);
  });

  it('rejects a PATCH switching to workflow while inheriting a file:// startUrl', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    const fixtureUrl = 'file:///workspace/fixtures/dummy-bill.html';
    const original = canonicalAdapterJob({ userId: user.id, startUrl: fixtureUrl });
    await store.upsertJob(original);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ engine: 'workflow' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await store.getJob('home-eb'), original);
  });

  it('allows a PATCH to workflow when a public startUrl comes with it', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    await store.upsertJob(
      canonicalAdapterJob({
        userId: user.id,
        startUrl: 'file:///workspace/fixtures/dummy-bill.html',
      }),
    );

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        engine: 'workflow',
        startUrl: 'https://sivadass.in/',
        workflow: replayableWorkflow,
      }),
    });

    assert.equal(response.status, 200);
    const patched = (await response.json()) as JobDocument;
    assert.equal(patched.engine, 'workflow');
    assert.equal(patched.startUrl, 'https://sivadass.in/');
  });

  it('keeps editing a workflow job whose startUrl is not resupplied', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    const fixtureUrl = 'file:///workspace/fixtures/shop.html';
    await store.upsertJob({
      ...canonicalAdapterJob({ userId: user.id, startUrl: fixtureUrl }),
      engine: 'workflow',
      adapterId: undefined,
      workflow: [
        { id: 'open', type: 'goto', url: fixtureUrl },
        {
          id: 'read-price',
          type: 'extract',
          fields: [{ key: 'price', selector: '.price', strategy: 'text' }],
        },
      ],
    } as JobDocument);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });

    assert.equal(response.status, 200);
    assert.equal((await store.getJob('home-eb'))?.startUrl, fixtureUrl);
  });

  it('still creates an adapter job without a startUrl', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'adapter-no-url',
        engine: 'adapter',
        adapterId: 'dummy',
        notify: { title: 'Dummy Bill' },
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(((await response.json()) as JobDocument).startUrl, '');
  });
});

describe('the documented create-job examples match the API contract', () => {
  // Kept byte-for-byte in step with the payloads in the root README and the
  // Postman collection; a drift here means the docs tell callers a lie.
  const adapterExample = {
    id: 'smoke-test',
    name: 'Dummy Bill',
    engine: 'adapter',
    adapterId: 'dummy',
    enabled: true,
    schedule: null,
    notify: {
      title: 'Dummy Bill',
      on: 'always',
      channel: { type: 'ntfy', topic: 'bills' },
    },
  };

  const workflowExample = {
    id: 'shoe-price',
    name: 'Shoe price',
    engine: 'workflow',
    startUrl: 'https://sivadass.in/',
    goal: 'Read the listed price',
    schema: [{ key: 'price', label: 'Price', type: 'price' }],
    workflow: [
      { id: 'open', type: 'goto', url: 'https://sivadass.in/' },
      {
        id: 'read-price',
        type: 'extract',
        fields: [{ key: 'price', selector: '.product-price', strategy: 'price' }],
      },
    ],
    notify: { title: 'Shoe price' },
  };

  async function post(
    port: number,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  it('accepts the documented adapter example', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await post(handle.port, token, adapterExample);

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.equal(created.engine, 'adapter');
    assert.equal(created.adapterId, 'dummy');
  });

  it('accepts the documented workflow example', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await post(handle.port, token, workflowExample);

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.equal(created.engine, 'workflow');
    assert.equal(created.startUrl, 'https://sivadass.in/');
    assert.deepEqual(created.schema, [
      { key: 'price', label: 'Price', type: 'price' },
    ]);
    assert.equal(created.workflow.length, 2);
  });

  it('rejects the schema shape the docs used to show', async () => {
    const { handle, token } = await setupAuthedServer();

    const response = await post(handle.port, token, {
      ...workflowExample,
      schema: [{ name: 'price', type: 'number' }],
    });

    assert.equal(response.status, 400);
  });
});

describe('PATCH /jobs/:id validates only what the caller supplies', () => {
  async function patchJob(
    port: number,
    token: string,
    body: Record<string, unknown>,
    jobId = 'home-eb',
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/jobs/${jobId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects malformed supplied values with 400 and leaves the job untouched', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    const original = canonicalAdapterJob({ userId: user.id });
    await store.upsertJob(original);

    for (const body of [
      { enabled: 'nope' },
      { schedule: 12 },
      { notify: { on: 'whenever' } },
      { notify: { channel: { type: 'smoke-signal' } } },
      { notify: { channel: { type: 'webhook', url: 'http://localhost/hook' } } },
      { startUrl: 'file:///etc/passwd' },
      { startUrl: 'http://169.254.169.254/latest/meta-data/' },
      { startUrl: '' },
    ]) {
      const response = await patchJob(handle.port, token, body);
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }

    assert.deepEqual(await store.getJob('home-eb'), original);
  });

  it('refuses to clear the startUrl of a migrated fixture job', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    const fixtureUrl = 'file:///workspace/fixtures/dummy-bill.html';
    await store.upsertJob(canonicalAdapterJob({ userId: user.id, startUrl: fixtureUrl }));

    const response = await patchJob(handle.port, token, { startUrl: '' });

    assert.equal(response.status, 400);
    assert.equal((await store.getJob('home-eb'))?.startUrl, fixtureUrl);
  });

  it('keeps a migrated fixture startUrl when startUrl is not supplied', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    const fixtureUrl = 'file:///workspace/fixtures/dummy-bill.html';
    await store.upsertJob(
      canonicalAdapterJob({ userId: user.id, startUrl: fixtureUrl }),
    );

    const response = await patchJob(handle.port, token, { enabled: false });
    assert.equal(response.status, 200);
    const patched = (await response.json()) as JobDocument;
    assert.equal(patched.enabled, false);
    assert.equal(patched.startUrl, fixtureUrl);
    assert.equal((await store.getJob('home-eb'))?.startUrl, fixtureUrl);
  });

  it('accepts a public startUrl and stores it', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    await store.upsertJob(canonicalAdapterJob({ userId: user.id }));

    const response = await patchJob(handle.port, token, {
      startUrl: 'https://www.tnebnet.org/awp/login2',
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await store.getJob('home-eb'))?.startUrl,
      'https://www.tnebnet.org/awp/login2',
    );
  });

  it('ignores client attempts to set secretIds, lastResult, or timestamps', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    await store.upsertJob(
      canonicalAdapterJob({
        userId: user.id,
        secretIds: ['secret-owned'],
        lastResult: { amount: 10 },
        createdAt: '2020-01-01T00:00:00.000Z',
      }),
    );

    const response = await patchJob(handle.port, token, {
      secretIds: ['injected-secret'],
      lastResult: { amount: 999999 },
      createdAt: '1999-01-01T00:00:00.000Z',
      userId: 'someone-else',
    });
    assert.equal(response.status, 200);

    const stored = await store.getJob('home-eb');
    assert.deepEqual(stored?.secretIds, ['secret-owned']);
    assert.deepEqual(stored?.lastResult, { amount: 10 });
    assert.equal(stored?.createdAt, '2020-01-01T00:00:00.000Z');
    assert.equal(stored?.userId, user.id);
  });

  it('ignores client-supplied secretIds and lastResult on create', async () => {
    const store = new MemoryStore();
    const { handle, token } = await setupAuthedServer({ store });

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        canonicalJobPayload({
          id: 'injected',
          secretIds: ['injected-secret'],
          lastResult: { amount: 999999 },
        }),
      ),
    });

    assert.equal(response.status, 201);
    const created = (await response.json()) as JobDocument;
    assert.deepEqual(created.secretIds, []);
    assert.equal(created.lastResult, null);
  });
});

describe('runs expose the generic result', () => {
  it('returns result and never billSummary or provider', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({ store });
    const run = canonicalRun({
      id: 'run-generic',
      userId: user.id,
      result: { amount: 1234.5, dueDate: '2026-09-01' },
    });
    await store.createRun({
      ...run,
      // A document written before the migration can still carry these keys.
      provider: 'dummy',
      billSummary: { total: '1234.5' },
    } as RunDocument);

    const detail = await fetch(`http://127.0.0.1:${handle.port}/runs/run-generic`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(detail.status, 200);
    const detailText = await detail.text();
    assert.equal(detailText.includes('billSummary'), false);
    assert.equal(detailText.includes('provider'), false);
    const detailBody = JSON.parse(detailText) as RunDocument;
    assert.deepEqual(detailBody.result, { amount: 1234.5, dueDate: '2026-09-01' });
    assert.equal(detailBody.engine, 'adapter');
    assert.equal(detailBody.adapterId, 'dummy');

    const list = await fetch(`http://127.0.0.1:${handle.port}/runs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(list.status, 200);
    const listText = await list.text();
    assert.equal(listText.includes('billSummary'), false);
    const runs = JSON.parse(listText) as RunDocument[];
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]?.result, { amount: 1234.5, dueDate: '2026-09-01' });
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
      body: JSON.stringify(canonicalJobPayload({ id: 'a-only-job' })),
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
      body: JSON.stringify(canonicalJobPayload({ id: 'a-only-job-2' })),
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
      body: JSON.stringify(canonicalJobPayload({ id: 'a-only-job-3' })),
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
      body: JSON.stringify(canonicalJobPayload({ id: 'a-only-job-4' })),
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
      body: JSON.stringify(canonicalJobPayload({ id: 'a-only-job-5' })),
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

    await store.createRun(
      canonicalRun({ id: 'a-only-run', jobId: 'a-only-job', userId: userA.id }),
    );

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
    return canonicalAdapterJob({ userId });
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
    await store.createRun(
      canonicalRun({
        id: 'existing',
        jobId: 'home-eb',
        userId: user.id,
        status: 'running',
        finishedAt: null,
        durationMs: null,
      }),
    );

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 409);
  });

  it('returns 409 Browser busy when an authoring session holds the browser lock', async () => {
    const store = new MemoryStore();
    const lock = createBrowserLock();
    lock.tryAcquire({ kind: 'authoring', id: 'conversation-1' });
    let runStarts = 0;
    const { handle, user, token } = await setupAuthedServer({
      store,
      lock,
      onRunJob: async () => {
        runStarts += 1;
        return 'run-x';
      },
    });
    await store.upsertJob(enabledJobFor(user.id));

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Browser busy' });
    assert.equal(runStarts, 0);
  });

  it('returns 409 Browser busy when another job run holds the browser lock', async () => {
    const store = new MemoryStore();
    const lock = createBrowserLock();
    lock.tryAcquire({ kind: 'run', id: 'run-elsewhere' });
    const { handle, user, token } = await setupAuthedServer({
      store,
      lock,
      onRunJob: async () => 'run-x',
    });
    await store.upsertJob(enabledJobFor(user.id));

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Browser busy' });
  });

  it('starts the run once the lock is released', async () => {
    const store = new MemoryStore();
    const lock = createBrowserLock();
    lock.tryAcquire({ kind: 'authoring', id: 'conversation-1' });
    const { handle, user, token } = await setupAuthedServer({
      store,
      lock,
      onRunJob: async () => 'run-123',
    });
    await store.upsertJob(enabledJobFor(user.id));
    const url = `http://127.0.0.1:${handle.port}/jobs/home-eb/run`;
    const headers = { Authorization: `Bearer ${token}` };

    assert.equal((await fetch(url, { method: 'POST', headers })).status, 409);

    lock.release('conversation-1');

    const response = await fetch(url, { method: 'POST', headers });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { id: 'run-123' });
  });

  it('answers 409 Browser busy when the runner loses the lock race', async () => {
    const store = new MemoryStore();
    const { handle, user, token } = await setupAuthedServer({
      store,
      lock: createBrowserLock(),
      onRunJob: async () => {
        throw new Error('Browser busy');
      },
    });
    await store.upsertJob(enabledJobFor(user.id));

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Browser busy' });
  });

  it('keeps the per-job "already running" 409 ahead of the lock check', async () => {
    const store = new MemoryStore();
    const lock = createBrowserLock();
    lock.tryAcquire({ kind: 'run', id: 'run-for-this-job' });
    const { handle, user, token } = await setupAuthedServer({
      store,
      lock,
      onRunJob: async () => 'run-x',
    });
    await store.upsertJob(enabledJobFor(user.id));
    await store.createRun(
      canonicalRun({
        id: 'existing',
        jobId: 'home-eb',
        userId: user.id,
        status: 'running',
        finishedAt: null,
        durationMs: null,
      }),
    );

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Job already running' });
  });
});

describe('job secrets api', () => {
  async function setupJobWithSecrets(options?: { env?: NodeJS.ProcessEnv }) {
    const store = new MemoryStore();
    const context = await setupAuthedServer({ store, env: options?.env });
    await store.upsertJob(canonicalAdapterJob({ userId: context.user.id }));
    return { ...context, store };
  }

  function secretsUrl(port: number, jobId = 'home-eb'): string {
    return `http://127.0.0.1:${port}/jobs/${jobId}/secrets`;
  }

  async function putSecrets(
    port: number,
    token: string,
    values: unknown,
    jobId = 'home-eb',
  ): Promise<Response> {
    return fetch(secretsUrl(port, jobId), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });
  }

  it('GET returns an empty key list for a job with no secrets', async () => {
    const { handle, token } = await setupJobWithSecrets();

    const response = await fetch(secretsUrl(handle.port), {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { keys: [] });
  });

  it('GET /jobs/:id/secrets is not shadowed by the job detail route', async () => {
    const { handle, token } = await setupJobWithSecrets();

    const secrets = await fetch(secretsUrl(handle.port), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const secretsBody = (await secrets.json()) as Record<string, unknown>;
    assert.equal('keys' in secretsBody, true);
    assert.equal('engine' in secretsBody, false);
    assert.equal('id' in secretsBody, false);

    const job = await fetch(`http://127.0.0.1:${handle.port}/jobs/home-eb`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(job.status, 200);
    assert.equal(((await job.json()) as JobDocument).id, 'home-eb');
  });

  it('PUT encrypts values and GET reports only which keys are set', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();

    const put = await putSecrets(handle.port, token, {
      username: 'eb-user',
      password: 'sup3r-secret',
    });
    assert.equal(put.status, 200);
    const putText = await put.text();
    assert.equal(putText.includes('sup3r-secret'), false);
    assert.deepEqual(JSON.parse(putText), {
      keys: [
        { key: 'password', set: true },
        { key: 'username', set: true },
      ],
    });

    const stored = await store.listSecrets({ userId: user.id, jobId: 'home-eb' });
    assert.equal(stored.length, 2);
    const password = stored.find((secret) => secret.key === 'password');
    assert.ok(password);
    assert.notEqual(password.ciphertext, 'sup3r-secret');
    assert.equal(password.conversationId, null);
    assert.equal(password.userId, user.id);
    assert.equal(
      decryptSecret(password, parseMasterKey(TEST_ENV)),
      'sup3r-secret',
    );

    const get = await fetch(secretsUrl(handle.port), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getText = await get.text();
    assert.equal(getText.includes('sup3r-secret'), false);
    assert.equal(getText.includes('ciphertext'), false);
    assert.equal(getText.includes('"iv"'), false);
    assert.equal(getText.includes('tag'), false);
    assert.deepEqual(JSON.parse(getText), {
      keys: [
        { key: 'password', set: true },
        { key: 'username', set: true },
      ],
    });
  });

  it('PUT records the secret ids on the job so the runner can decrypt them', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();

    await putSecrets(handle.port, token, { password: 'first-password' });

    const stored = await store.listSecrets({ userId: user.id, jobId: 'home-eb' });
    assert.equal(stored.length, 1);
    const job = await store.getJob('home-eb');
    assert.deepEqual(job?.secretIds, stored.map((secret) => secret.id));
  });

  it('PUT re-encrypts the same (jobId, key) row on a password change', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();

    await putSecrets(handle.port, token, { password: 'first-password' });
    const first = await store.listSecrets({ userId: user.id, jobId: 'home-eb' });
    assert.equal(first.length, 1);

    const second = await putSecrets(handle.port, token, { password: 'second-password' });
    assert.equal(second.status, 200);

    const after = await store.listSecrets({ userId: user.id, jobId: 'home-eb' });
    assert.equal(after.length, 1);
    assert.equal(after[0]?.id, first[0]?.id);
    assert.equal(after[0]?.createdAt, first[0]?.createdAt);
    assert.notEqual(after[0]?.ciphertext, first[0]?.ciphertext);
    assert.equal(
      decryptSecret(after[0]!, parseMasterKey(TEST_ENV)),
      'second-password',
    );

    const job = await store.getJob('home-eb');
    assert.deepEqual(job?.secretIds, [first[0]?.id]);
  });

  it('PUT leaves omitted keys untouched', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();

    await putSecrets(handle.port, token, {
      username: 'eb-user',
      password: 'first-password',
    });
    const before = await store.listSecrets({ userId: user.id, jobId: 'home-eb' });
    const usernameBefore = before.find((secret) => secret.key === 'username');

    const response = await putSecrets(handle.port, token, { password: 'second-password' });
    assert.equal(response.status, 200);

    const after = await store.listSecrets({ userId: user.id, jobId: 'home-eb' });
    assert.equal(after.length, 2);
    const usernameAfter = after.find((secret) => secret.key === 'username');
    assert.deepEqual(usernameAfter, usernameBefore);
    assert.equal(
      decryptSecret(
        after.find((secret) => secret.key === 'password')!,
        parseMasterKey(TEST_ENV),
      ),
      'second-password',
    );
  });

  it('PUT with an empty values object is a no-op that returns the current keys', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();
    await putSecrets(handle.port, token, { password: 'first-password' });
    const before = await store.listSecrets({ userId: user.id, jobId: 'home-eb' });

    const response = await putSecrets(handle.port, token, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { keys: [{ key: 'password', set: true }] });
    assert.deepEqual(
      await store.listSecrets({ userId: user.id, jobId: 'home-eb' }),
      before,
    );
  });

  it('PUT rejects an empty string value with 400 and persists nothing', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();

    const response = await putSecrets(handle.port, token, {
      username: 'eb-user',
      password: '',
    });
    assert.equal(response.status, 400);
    assert.equal(
      (await store.listSecrets({ userId: user.id, jobId: 'home-eb' })).length,
      0,
    );
  });

  it('PUT rejects a non-string value with 400', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();

    const response = await putSecrets(handle.port, token, { password: 12345 });
    assert.equal(response.status, 400);
    assert.equal(
      (await store.listSecrets({ userId: user.id, jobId: 'home-eb' })).length,
      0,
    );
  });

  it('PUT rejects a missing or malformed values object with 400', async () => {
    const { handle, token } = await setupJobWithSecrets();

    const missing = await fetch(secretsUrl(handle.port), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);

    const arrayValues = await putSecrets(handle.port, token, ['password']);
    assert.equal(arrayValues.status, 400);
  });

  it('answers a malformed JSON body with a fixed message that echoes nothing', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();

    const response = await fetch(secretsUrl(handle.port), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{"values": {"password": "hunter2"',
    });

    assert.equal(response.status, 400);
    const text = await response.text();
    assert.equal(text.includes('hunter2'), false);
    assert.equal(text.includes('password'), false);
    assert.deepEqual(JSON.parse(text), { error: 'Invalid request body' });
    assert.equal(
      (await store.listSecrets({ userId: user.id, jobId: 'home-eb' })).length,
      0,
    );
  });

  it('keeps one user two jobs isolated from each other', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();
    await store.upsertJob(
      canonicalAdapterJob({ id: 'second-job', userId: user.id }),
    );

    await putSecrets(handle.port, token, { password: 'first-job-password' });

    const otherJobKeys = await fetch(secretsUrl(handle.port, 'second-job'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(otherJobKeys.status, 200);
    assert.deepEqual(await otherJobKeys.json(), { keys: [] });
    assert.equal(
      (await store.listSecrets({ userId: user.id, jobId: 'second-job' })).length,
      0,
    );

    const secondPut = await putSecrets(
      handle.port,
      token,
      { password: 'second-job-password' },
      'second-job',
    );
    assert.equal(secondPut.status, 200);

    const first = await store.listSecrets({ userId: user.id, jobId: 'home-eb' });
    const second = await store.listSecrets({ userId: user.id, jobId: 'second-job' });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0]?.id, second[0]?.id);
    const masterKey = parseMasterKey(TEST_ENV);
    assert.equal(decryptSecret(first[0]!, masterKey), 'first-job-password');
    assert.equal(decryptSecret(second[0]!, masterKey), 'second-job-password');
    assert.deepEqual((await store.getJob('home-eb'))?.secretIds, [first[0]?.id]);
    assert.deepEqual((await store.getJob('second-job'))?.secretIds, [second[0]?.id]);
  });

  it('returns 404 for a missing job', async () => {
    const { handle, token } = await setupJobWithSecrets();

    const get = await fetch(secretsUrl(handle.port, 'nope'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(get.status, 404);

    const put = await putSecrets(handle.port, token, { password: 'x' }, 'nope');
    assert.equal(put.status, 404);
  });

  it('returns 404 for another user job and never writes their secrets', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();
    const other = await createUser(store, 'secret-other@example.com', 'other-password');
    const otherLogin = await login(handle.port, other.email, 'other-password');
    const otherToken = otherLogin.body.token;
    if (!otherToken) throw new Error('other user login failed');

    const get = await fetch(secretsUrl(handle.port), {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(get.status, 404);

    const put = await putSecrets(handle.port, otherToken, { password: 'stolen' });
    assert.equal(put.status, 404);
    assert.equal(
      (await store.listSecrets({ userId: user.id, jobId: 'home-eb' })).length,
      0,
    );
    assert.equal(
      (await store.listSecrets({ userId: other.id, jobId: 'home-eb' })).length,
      0,
    );
  });

  it('PUT returns 409 while the job has a running run', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();
    await store.createRun(
      canonicalRun({
        id: 'run-in-flight',
        jobId: 'home-eb',
        userId: user.id,
        status: 'running',
        finishedAt: null,
        durationMs: null,
      }),
    );

    const response = await putSecrets(handle.port, token, { password: 'while-running' });
    assert.equal(response.status, 409);
    assert.equal(
      (await store.listSecrets({ userId: user.id, jobId: 'home-eb' })).length,
      0,
    );

    const get = await fetch(secretsUrl(handle.port), {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(get.status, 200);
  });

  it('PUT ignores a run of another job when checking for a running run', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets();
    await store.createRun(
      canonicalRun({
        id: 'other-job-run',
        jobId: 'another-job',
        userId: user.id,
        status: 'running',
        finishedAt: null,
        durationMs: null,
      }),
    );

    const response = await putSecrets(handle.port, token, { password: 'ok' });
    assert.equal(response.status, 200);
  });

  it('fails without leaking the value when the master key is missing', async () => {
    const { handle, store, user, token } = await setupJobWithSecrets({ env: {} });

    const response = await putSecrets(handle.port, token, { password: 'never-stored' });
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.equal(text.includes('never-stored'), false);
    assert.equal(
      (await store.listSecrets({ userId: user.id, jobId: 'home-eb' })).length,
      0,
    );
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
