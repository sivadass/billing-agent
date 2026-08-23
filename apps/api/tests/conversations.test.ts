import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import type {
  BillingStore,
  ConversationDocument,
  JobDocument,
  SecretDocument,
  SettingsDocument,
  UserDocument,
} from '@billing-agent/core';
import {
  encryptSecret,
  hashPassword,
  parseMasterKey,
} from '@billing-agent/core';
import { startServer } from '../src/server.ts';

const JWT_SECRET = 'test-jwt-secret';
const MASTER_KEY_HEX = '11'.repeat(32);
const TEST_ENV: NodeJS.ProcessEnv = { SECRETS_MASTER_KEY: MASTER_KEY_HEX };

class ConversationMemoryStore implements BillingStore {
  settings: SettingsDocument = {
    id: 'default',
    ntfy: { baseUrl: 'https://ntfy.sh', topicEnv: 'NTFY_TOPIC', priority: 'default' },
    mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
    browser: { headless: true, timeoutMs: 60_000, saveErrorScreenshot: true },
    jobsGeneration: 0,
  };

  jobs = new Map<string, JobDocument>();
  conversations = new Map<string, ConversationDocument>();
  secrets = new Map<string, SecretDocument>();
  users = new Map<string, UserDocument>();

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

  async deleteSecretsForJob(): Promise<void> {}

  async upsertConversation(conversation: ConversationDocument): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async getConversation(id: string): Promise<ConversationDocument | null> {
    return this.conversations.get(id) ?? null;
  }

  async listConversations(options?: {
    userId?: string;
    status?: ConversationDocument['status'] | ConversationDocument['status'][];
  }): Promise<ConversationDocument[]> {
    let conversations = [...this.conversations.values()];
    if (options?.userId) {
      conversations = conversations.filter((c) => c.userId === options.userId);
    }
    if (options?.status !== undefined) {
      const allowed = Array.isArray(options.status) ? options.status : [options.status];
      conversations = conversations.filter((c) => allowed.includes(c.status));
    }
    return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listActiveOverlays() {
    return [];
  }

  async recordOverlaySuccess(): Promise<never> {
    throw new Error('not implemented');
  }

  async createRun(): Promise<void> {}

  async finishRun(): Promise<void> {}

  async listRuns() {
    return [];
  }

  async getRun() {
    return null;
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

const handles: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (handles.length > 0) {
    await handles.pop()?.close();
  }
});

async function createUser(
  store: ConversationMemoryStore,
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

async function login(port: number, email: string, password: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error('login did not return a token');
  return body.token;
}

async function setupServer(options?: {
  store?: ConversationMemoryStore;
  onAuthorConversation?: (conversationId: string) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}) {
  const store = options?.store ?? new ConversationMemoryStore();
  const user = await createUser(store, 'owner@example.com', 'correct-password');
  const handle = await startServer({
    port: 0,
    jwtSecret: JWT_SECRET,
    store,
    env: { ...TEST_ENV, ...options?.env },
    onAuthorConversation: options?.onAuthorConversation,
  });
  handles.push(handle);
  const token = await login(handle.port, user.email, 'correct-password');
  return { handle, store, user, token };
}

function confirmingConversation(
  userId: string,
  overrides: Partial<ConversationDocument> = {},
): ConversationDocument {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    status: 'confirming',
    jobId: null,
    startUrl: 'https://sivadass.in/',
    goal: 'Grab the contact email address',
    messages: [],
    draftWorkflow: [
      { id: 'goto-home', type: 'goto', url: 'https://sivadass.in/' },
      {
        id: 'extract-email',
        type: 'extract',
        fields: [{ key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' }],
      },
    ],
    draftSchema: [{ key: 'email', label: 'Email', type: 'string' }],
    draftExtract: { email: 'contact@sivadass.in' },
    draftNotify: {
      title: 'Sivadass contact email',
      on: 'always',
      channel: { type: 'ntfy', topic: 'alerts' },
    },
    draftSchedule: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('conversation API state machine', () => {
  it('returns 409 when confirming while status is active', async () => {
    const { handle, store, user, token } = await setupServer();
    const conversation: ConversationDocument = {
      ...confirmingConversation(user.id),
      status: 'active',
    };
    await store.upsertConversation(conversation);

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/conversations/${conversation.id}/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      },
    );

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Conversation not confirming' });
  });

  it('returns 409 when posting secrets while status is active', async () => {
    const { handle, store, user, token } = await setupServer();
    const conversation: ConversationDocument = {
      ...confirmingConversation(user.id),
      status: 'active',
    };
    await store.upsertConversation(conversation);

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/conversations/${conversation.id}/secrets`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ values: { password: 'secret-value' } }),
      },
    );

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Conversation not awaiting secret' });
  });

  it('confirm in confirming creates workflow job, attaches secrets, marks conversation saved', async () => {
    const { handle, store, user, token } = await setupServer();
    const conversation = confirmingConversation(user.id);
    await store.upsertConversation(conversation);

    const masterKey = parseMasterKey(TEST_ENV);
    const passwordSecret: SecretDocument = {
      id: randomUUID(),
      userId: user.id,
      jobId: null,
      conversationId: conversation.id,
      key: 'password',
      ...encryptSecret('hunter2', masterKey),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.upsertSecret(passwordSecret);

    const beforeGeneration = store.settings.jobsGeneration;

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/conversations/${conversation.id}/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      },
    );

    assert.equal(response.status, 201);
    const body = (await response.json()) as { jobId: string; conversationId: string };
    assert.equal(body.conversationId, conversation.id);
    assert.match(body.jobId, /^[0-9a-f-]{36}$/);

    const job = await store.getJob(body.jobId);
    assert.ok(job);
    assert.equal(job.engine, 'workflow');
    assert.equal(job.startUrl, conversation.startUrl);
    assert.equal(job.goal, conversation.goal);
    assert.deepEqual(job.workflow, conversation.draftWorkflow);
    assert.deepEqual(job.schema, conversation.draftSchema);
    assert.deepEqual(job.notify, conversation.draftNotify);
    assert.deepEqual(job.lastResult, conversation.draftExtract);
    assert.equal(job.secretIds.length, 1);
    assert.ok(job.secretIds.includes(passwordSecret.id));

    const movedSecret = [...store.secrets.values()].find(
      (secret) => secret.id === passwordSecret.id,
    );
    assert.ok(movedSecret);
    assert.equal(movedSecret.jobId, body.jobId);
    assert.equal(movedSecret.conversationId, null);

    const updatedConversation = await store.getConversation(conversation.id);
    assert.ok(updatedConversation);
    assert.equal(updatedConversation.status, 'saved');
    assert.equal(updatedConversation.jobId, body.jobId);

    assert.equal(store.settings.jobsGeneration, beforeGeneration + 1);
  });

  it('returns 503 on POST /conversations when onAuthorConversation is missing', async () => {
    const { handle, token } = await setupServer({ onAuthorConversation: undefined });

    const response = await fetch(`http://127.0.0.1:${handle.port}/conversations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startUrl: 'https://sivadass.in/',
        goal: 'Grab the contact email address',
      }),
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Authoring unavailable' });
  });
});

describe('GET /conversations', () => {
  it('returns the caller summaries newest-first and omits messages and drafts', async () => {
    const { handle, store, user, token } = await setupServer();
    const older = confirmingConversation(user.id, {
      id: 'conv-older',
      status: 'saved',
      jobId: 'job-1',
      goal: 'Older goal',
      messages: [{ id: 'm1', role: 'assistant', text: 'done', createdAt: '2026-08-01T00:00:00.000Z' }],
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const newer = confirmingConversation(user.id, {
      id: 'conv-newer',
      status: 'active',
      goal: 'Newer goal',
      messages: [{ id: 'm2', role: 'user', text: 'hello', createdAt: '2026-08-02T00:00:00.000Z' }],
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    await store.upsertConversation(older);
    await store.upsertConversation(newer);

    const response = await fetch(`http://127.0.0.1:${handle.port}/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    assert.equal(body.length, 2);
    assert.equal(body[0]?.id, 'conv-newer');
    assert.equal(body[1]?.id, 'conv-older');
    assert.deepEqual(body[0], {
      id: 'conv-newer',
      status: 'active',
      goal: 'Newer goal',
      startUrl: 'https://sivadass.in/',
      jobId: null,
      createdAt: newer.createdAt,
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(body[0]?.messages, undefined);
    assert.equal('draftWorkflow' in body[0]!, false);
    assert.equal('draftSchema' in body[0]!, false);
    assert.equal('draftExtract' in body[0]!, false);
    assert.equal('draftNotify' in body[0]!, false);
    assert.equal('draftSchedule' in body[0]!, false);
    assert.equal('userId' in body[0]!, false);
  });

  it('excludes another user conversation from the list', async () => {
    const { handle, store, user, token } = await setupServer();
    await store.upsertConversation(
      confirmingConversation(user.id, { id: 'mine', goal: 'Mine' }),
    );
    const other = await createUser(store, 'other@example.com', 'other-password');
    await store.upsertConversation(
      confirmingConversation(other.id, { id: 'theirs', goal: 'Theirs' }),
    );

    const response = await fetch(`http://127.0.0.1:${handle.port}/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as Array<{ id: string }>;
    assert.deepEqual(
      body.map((row) => row.id),
      ['mine'],
    );
  });

  it('does not treat GET /conversations as GET /conversations/:id', async () => {
    const { handle, token } = await setupServer();
    const response = await fetch(`http://127.0.0.1:${handle.port}/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});

describe('GET /conversations/:id screenshots', () => {
  it('attaches a presigned screenshot URL for B2 keys', async () => {
    const { handle, store, user, token } = await setupServer({
      env: {
        B2_ACCESS_KEY_ID: 'test-key',
        B2_SECRET_ACCESS_KEY: 'test-secret',
        B2_BUCKET_NAME: 'notepad-attachments',
        B2_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
      },
    });
    const key = 'billing-agent/conversations/conv-1/1.png';
    await store.upsertConversation(
      confirmingConversation(user.id, {
        id: 'conv-1',
        status: 'active',
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            text: 'Captured a page snapshot.',
            screenshotPath: key,
            createdAt: '2026-08-19T00:00:00.000Z',
          },
        ],
      }),
    );

    const response = await fetch(`http://127.0.0.1:${handle.port}/conversations/conv-1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      messages: Array<{ screenshotPath?: string; screenshotUrl?: string }>;
    };
    assert.equal(body.messages[0]?.screenshotPath, key);
    assert.match(body.messages[0]?.screenshotUrl ?? '', /X-Amz-Signature=/);
    assert.match(body.messages[0]?.screenshotUrl ?? '', /billing-agent\/conversations\/conv-1\/1\.png/);
  });
});
