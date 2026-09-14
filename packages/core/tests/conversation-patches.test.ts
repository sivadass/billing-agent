import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  ConversationDocument,
  ConversationMessage,
  ConversationPatch,
} from '../src/store/types.ts';

function baseConversation(): ConversationDocument {
  const now = '2026-09-14T00:00:00.000Z';
  return {
    id: 'conv-1',
    userId: 'user-1',
    status: 'active',
    jobId: null,
    startUrl: 'https://sivadass.in/',
    goal: 'Grab the contact email address',
    messages: [
      { id: 'm1', role: 'assistant', text: 'Working on it…', createdAt: now },
    ],
    draftWorkflow: null,
    draftSchema: null,
    draftExtract: null,
    draftNotify: null,
    draftSchedule: null,
    createdAt: now,
    updatedAt: now,
  };
}

class PatchMemoryStore {
  conversations = new Map<string, ConversationDocument>();

  async upsertConversation(conversation: ConversationDocument) {
    this.conversations.set(conversation.id, conversation);
  }

  async getConversation(id: string) {
    return this.conversations.get(id) ?? null;
  }

  async appendConversationMessage(id: string, message: ConversationMessage) {
    const existing = this.conversations.get(id);
    if (!existing) return null;
    const updatedAt = new Date().toISOString();
    const updated: ConversationDocument = {
      ...existing,
      messages: [...existing.messages, message],
      updatedAt,
    };
    this.conversations.set(id, updated);
    return updated;
  }

  async patchConversation(id: string, fields: ConversationPatch) {
    const existing = this.conversations.get(id);
    if (!existing) return null;
    const updatedAt = new Date().toISOString();
    const updated: ConversationDocument = {
      ...existing,
      ...fields,
      updatedAt,
    };
    this.conversations.set(id, updated);
    return updated;
  }
}

describe('conversation patches', () => {
  it('appendConversationMessage keeps existing messages', async () => {
    const store = new PatchMemoryStore();
    await store.upsertConversation(baseConversation());
    const incoming: ConversationMessage = {
      id: 'm2',
      role: 'user',
      text: 'continue',
      createdAt: '2026-09-14T00:01:00.000Z',
    };
    const updated = await store.appendConversationMessage('conv-1', incoming);
    assert.equal(updated?.messages.length, 2);
    assert.equal(updated?.messages[0]?.id, 'm1');
    assert.equal(updated?.messages[1]?.id, 'm2');
    assert.equal((await store.getConversation('conv-1'))?.messages.length, 2);
  });

  it('patchConversation does not drop messages', async () => {
    const store = new PatchMemoryStore();
    await store.upsertConversation(baseConversation());
    const updated = await store.patchConversation('conv-1', { status: 'awaiting_secret' });
    assert.equal(updated?.status, 'awaiting_secret');
    assert.equal(updated?.messages.length, 1);
    assert.equal(updated?.messages[0]?.id, 'm1');
  });

  it('returns null when the conversation is missing', async () => {
    const store = new PatchMemoryStore();
    assert.equal(
      await store.appendConversationMessage('missing', {
        id: 'm',
        role: 'user',
        text: 'x',
        createdAt: '2026-09-14T00:00:00.000Z',
      }),
      null,
    );
    assert.equal(await store.patchConversation('missing', { status: 'abandoned' }), null);
  });
});
