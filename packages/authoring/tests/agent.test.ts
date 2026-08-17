import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { createBrowserLock } from '@billing-agent/core';
import type {
  BillingStore,
  ConversationDocument,
  SettingsDocument,
} from '@billing-agent/core';
import {
  expireStaleAuthoringSessions,
  handleAuthoringTurn,
  type AuthoringDeps,
  type MistralCompletionResult,
} from '../src/agent.ts';
import { deleteAuthoringSession, setAuthoringSession } from '../src/session.ts';

class AuthoringMemoryStore implements BillingStore {
  settings: SettingsDocument = {
    id: 'default',
    ntfy: { baseUrl: 'https://ntfy.sh', priority: 'default' },
    mistral: { apiKeyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest' },
    browser: { headless: true, timeoutMs: 60_000, saveErrorScreenshot: false },
    jobsGeneration: 0,
  };

  conversations = new Map<string, ConversationDocument>();

  async getSettings(): Promise<SettingsDocument> {
    return this.settings;
  }

  async listJobs() {
    return [];
  }

  async getJob() {
    return null;
  }

  async upsertJob(): Promise<void> {}

  async upsertSettings(settings: Omit<SettingsDocument, 'id'>): Promise<void> {
    this.settings = { id: 'default', ...settings };
  }

  async upsertSecret(): Promise<void> {}

  async listSecrets() {
    return [];
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
    return conversations;
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

  async findUserByEmail() {
    return null;
  }

  async getUser() {
    return null;
  }

  async close(): Promise<void> {}
}

function activeConversation(
  overrides: Partial<ConversationDocument> = {},
): ConversationDocument {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId: 'user-1',
    status: 'active',
    jobId: null,
    startUrl: 'https://sivadass.in/',
    goal: 'Grab the contact email address',
    messages: [],
    draftWorkflow: null,
    draftSchema: null,
    draftExtract: null,
    draftNotify: null,
    draftSchedule: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockPage() {
  return {
    goto: async () => {},
    click: async () => {},
    fill: async () => {},
    waitForSelector: async () => {},
    waitForTimeout: async () => {},
    locator: (selector: string) => ({
      ariaSnapshot: async () => `snapshot:${selector}`,
      click: async () => {},
      fill: async () => {},
      textContent: async () => 'contact@sivadass.in',
      first: () => ({
        textContent: async () => 'contact@sivadass.in',
      }),
    }),
    screenshot: async () => Buffer.from('png'),
  };
}

async function runTurn(
  store: AuthoringMemoryStore,
  conversationId: string,
  deps: Partial<AuthoringDeps>,
): Promise<void> {
  const lock = createBrowserLock();
  lock.tryAcquire({ kind: 'authoring', id: conversationId });
  await handleAuthoringTurn({
    store,
    conversationId,
    lock,
    env: { MISTRAL_API_KEY: 'test-key' },
    mistral: store.settings.mistral,
    browser: store.settings.browser,
    deps: {
      launchSession: async () => ({
        browser: { close: async () => {} } as never,
        context: { close: async () => {} } as never,
        page: mockPage() as never,
        turnsThisMessage: 0,
        turnsTotal: 0,
        lastProcessedMessageId: null,
      }),
      completeWithTools: async () => ({ content: 'done' }),
      ...deps,
    },
  });
}

describe('handleAuthoringTurn', () => {
  it('sets awaiting_secret when the model calls ask_secret', async () => {
    const store = new AuthoringMemoryStore();
    const conversation = activeConversation({
      startUrl: 'file:///fixtures/login-extract.html',
      goal: 'Log in and read account email',
    });
    await store.upsertConversation(conversation);

    let callCount = 0;
    await runTurn(store, conversation.id, {
      completeWithTools: async (): Promise<MistralCompletionResult> => {
        callCount += 1;
        if (callCount === 1) {
          return {
            toolCalls: [
              {
                id: 'tc-1',
                name: 'ask_secret',
                arguments: JSON.stringify({
                  keys: ['username', 'password'],
                  message: 'Please enter your login credentials.',
                }),
              },
            ],
          };
        }
        return { content: 'unexpected follow-up' };
      },
    });

    const updated = await store.getConversation(conversation.id);
    assert.ok(updated);
    assert.equal(updated.status, 'awaiting_secret');
    assert.equal(callCount, 1);
    const assistant = updated.messages.find((message) => message.role === 'assistant');
    assert.ok(assistant);
    assert.match(assistant.text, /\[secret:username\]/);
    assert.match(assistant.text, /\[secret:password\]/);
    assert.doesNotMatch(assistant.text, /hunter2|plaintext/i);
  });

  it('sets confirming with draftExtract.email when the model calls propose_job', async () => {
    const store = new AuthoringMemoryStore();
    const conversation = activeConversation();
    await store.upsertConversation(conversation);

    const workflow = [
      { id: 'goto-home', type: 'goto', url: 'https://sivadass.in/' },
      {
        id: 'extract-email',
        type: 'extract',
        fields: [{ key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' }],
      },
    ];
    const schema = [{ key: 'email', label: 'Email', type: 'string' }];
    const extract = { email: 'contact@sivadass.in' };

    await runTurn(store, conversation.id, {
      completeWithTools: async () => ({
        toolCalls: [
          {
            id: 'tc-2',
            name: 'propose_job',
            arguments: JSON.stringify({
              workflow,
              schema,
              extract,
              message: 'I found the contact email on the page.',
            }),
          },
        ],
      }),
    });

    const updated = await store.getConversation(conversation.id);
    assert.ok(updated);
    assert.equal(updated.status, 'confirming');
    assert.deepEqual(updated.draftWorkflow, workflow);
    assert.deepEqual(updated.draftSchema, schema);
    assert.deepEqual(updated.draftExtract, extract);
  });

  it('never calls the real Mistral HTTP API', async () => {
    const store = new AuthoringMemoryStore();
    const conversation = activeConversation();
    await store.upsertConversation(conversation);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('real Mistral must not be called in CI');
    };

    try {
      await runTurn(store, conversation.id, {
        completeWithTools: async () => ({ content: 'ok' }),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const updated = await store.getConversation(conversation.id);
    assert.ok(updated?.messages.some((message) => message.role === 'assistant'));
  });
});

describe('expireStaleAuthoringSessions', () => {
  it('marks in-flight conversations expired when no live session exists', async () => {
    const store = new AuthoringMemoryStore();
    const conversation = activeConversation({ status: 'confirming' });
    await store.upsertConversation(conversation);

    const count = await expireStaleAuthoringSessions(store);
    assert.equal(count, 1);

    const updated = await store.getConversation(conversation.id);
    assert.equal(updated?.status, 'expired');
  });

  it('leaves conversations alone when a session is still live', async () => {
    const store = new AuthoringMemoryStore();
    const conversation = activeConversation();
    await store.upsertConversation(conversation);

    setAuthoringSession(conversation.id, {
      browser: { close: async () => {} } as never,
      context: { close: async () => {} } as never,
      page: mockPage() as never,
      turnsThisMessage: 0,
      turnsTotal: 0,
      lastProcessedMessageId: null,
    });

    const count = await expireStaleAuthoringSessions(store);
    assert.equal(count, 0);
    assert.equal((await store.getConversation(conversation.id))?.status, 'active');

    deleteAuthoringSession(conversation.id);
  });
});
