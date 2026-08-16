export type IndexKeys = Record<string, 1 | -1>;

export type IndexOptions = {
  unique?: boolean;
  name?: string;
  partialFilterExpression?: Record<string, unknown>;
};

export type IndexableCollection = {
  createIndex(keys: IndexKeys, options?: IndexOptions): Promise<unknown>;
};

export type IndexableCollections = {
  users: IndexableCollection;
  watches: IndexableCollection;
  priceChecks: IndexableCollection;
  secrets: IndexableCollection;
};

/**
 * Secrets are scoped either to a job or to a chat conversation, never both, and
 * the unused side of that pair is `null`. A single `(userId, jobId, key)` index
 * would therefore treat every conversation secret as a duplicate, so each scope
 * gets its own partial index keyed on the owning field being a string.
 */
export async function ensureStoreIndexes(
  collections: IndexableCollections,
): Promise<void> {
  await collections.users.createIndex({ email: 1 }, { unique: true });
  await collections.watches.createIndex({ userId: 1 });
  await collections.priceChecks.createIndex({ watchId: 1 });
  await collections.priceChecks.createIndex({ watchId: 1, checkedAt: -1 });
  await collections.secrets.createIndex({ id: 1 }, { unique: true });
  await collections.secrets.createIndex(
    { userId: 1, jobId: 1, key: 1 },
    {
      unique: true,
      name: 'secrets_owner_job_key_unique',
      partialFilterExpression: { jobId: { $type: 'string' } },
    },
  );
  await collections.secrets.createIndex(
    { userId: 1, conversationId: 1, key: 1 },
    {
      unique: true,
      name: 'secrets_owner_conversation_key_unique',
      partialFilterExpression: { conversationId: { $type: 'string' } },
    },
  );
}
