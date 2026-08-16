import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ensureStoreIndexes,
  type IndexKeys,
  type IndexOptions,
} from '../src/store/indexes.ts';

type RecordedIndex = { keys: IndexKeys; options?: IndexOptions };

function recordingCollections() {
  const created: Record<string, RecordedIndex[]> = {
    users: [],
    watches: [],
    priceChecks: [],
    secrets: [],
  };
  const collection = (name: string) => ({
    async createIndex(keys: IndexKeys, options?: IndexOptions) {
      created[name]?.push({ keys, ...(options ? { options } : {}) });
      return name;
    },
  });
  return {
    created,
    collections: {
      users: collection('users'),
      watches: collection('watches'),
      priceChecks: collection('priceChecks'),
      secrets: collection('secrets'),
    },
  };
}

describe('ensureStoreIndexes', () => {
  it('keeps the existing user, watch, and price check indexes', async () => {
    const { created, collections } = recordingCollections();

    await ensureStoreIndexes(collections);

    assert.deepEqual(created.users, [
      { keys: { email: 1 }, options: { unique: true } },
    ]);
    assert.deepEqual(created.watches, [{ keys: { userId: 1 } }]);
    assert.deepEqual(created.priceChecks, [
      { keys: { watchId: 1 } },
      { keys: { watchId: 1, checkedAt: -1 } },
    ]);
  });

  it('enforces one secret per owner, job, and key without touching conversation rows', async () => {
    const { created, collections } = recordingCollections();

    await ensureStoreIndexes(collections);

    const jobIndex = created.secrets?.find(
      (index) => index.options?.name === 'secrets_owner_job_key_unique',
    );
    assert.ok(jobIndex, 'expected a unique (userId, jobId, key) secrets index');
    assert.deepEqual(jobIndex.keys, { userId: 1, jobId: 1, key: 1 });
    assert.equal(jobIndex.options?.unique, true);
    // Conversation-scoped rows carry `jobId: null`; without this filter they
    // would all collide on the same (userId, null, key) tuple.
    assert.deepEqual(jobIndex.options?.partialFilterExpression, {
      jobId: { $type: 'string' },
    });
  });

  it('enforces one secret per owner, conversation, and key', async () => {
    const { created, collections } = recordingCollections();

    await ensureStoreIndexes(collections);

    const conversationIndex = created.secrets?.find(
      (index) => index.options?.name === 'secrets_owner_conversation_key_unique',
    );
    assert.ok(conversationIndex, 'expected a unique (userId, conversationId, key) index');
    assert.deepEqual(conversationIndex.keys, {
      userId: 1,
      conversationId: 1,
      key: 1,
    });
    assert.equal(conversationIndex.options?.unique, true);
    assert.deepEqual(conversationIndex.options?.partialFilterExpression, {
      conversationId: { $type: 'string' },
    });
  });

  it('indexes the secret id that upsertSecret filters on', async () => {
    const { created, collections } = recordingCollections();

    await ensureStoreIndexes(collections);

    const idIndex = created.secrets?.find(
      (index) => JSON.stringify(index.keys) === JSON.stringify({ id: 1 }),
    );
    assert.ok(idIndex, 'expected an id index on secrets');
    assert.equal(idIndex.options?.unique, true);
  });
});
