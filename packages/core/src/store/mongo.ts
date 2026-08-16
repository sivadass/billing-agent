import { MongoClient } from 'mongodb';
import { ConfigError } from '../errors.js';
import { assertJobDocument } from './assert-job.js';
import type {
  BillingStore,
  JobDocument,
  OverlayDocument,
  OverlaySuccessInput,
  PriceCheckDocument,
  RunDocument,
  SecretDocument,
  SettingsDocument,
  UserDocument,
  WatchDocument,
} from './types.js';

const SETTINGS_ID: SettingsDocument['id'] = 'default';

type Query<T> = Partial<{ [K in keyof T]: T[K] }>;
type Update<T> = {
  $set?: Partial<T>;
  $setOnInsert?: Partial<T>;
  $inc?: Record<string, number>;
};

type CollectionLike<T extends Record<string, unknown>> = {
  find(query?: Query<T>): { toArray(): Promise<T[]> };
  findOne(query: Query<T>): Promise<T | null>;
  insertOne(doc: T): Promise<unknown>;
  updateOne(
    filter: Query<T>,
    update: Update<T>,
    options?: { upsert?: boolean },
  ): Promise<unknown>;
  updateMany(filter: Query<T>, update: { $set: Partial<T> }): Promise<unknown>;
  deleteOne(filter: Query<T>): Promise<unknown>;
  deleteMany(filter: Query<T>): Promise<unknown>;
};

type StoreCollections = {
  jobs: CollectionLike<Record<string, unknown>>;
  settings: CollectionLike<SettingsDocument>;
  overlays: CollectionLike<OverlayDocument>;
  runs: CollectionLike<Record<string, unknown>>;
  secrets: CollectionLike<SecretDocument>;
  watches: CollectionLike<WatchDocument>;
  priceChecks: CollectionLike<PriceCheckDocument>;
  users: CollectionLike<UserDocument>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSettings(
  settings: Omit<SettingsDocument, 'id'>,
): Omit<SettingsDocument, 'id'> {
  return {
    ...settings,
    jobsGeneration: settings.jobsGeneration ?? 0,
    watchesGeneration: settings.watchesGeneration ?? 0,
  };
}

function coerceLegacyJob(raw: Record<string, unknown>): JobDocument {
  if (typeof raw.engine === 'string') {
    return assertJobDocument(raw);
  }

  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new ConfigError('job.id must be a non-empty string');
  }

  const notifyRaw = raw.notify;
  if (
    typeof notifyRaw !== 'object' ||
    notifyRaw === null ||
    Array.isArray(notifyRaw)
  ) {
    throw new ConfigError('job.notify must be an object');
  }
  const notifyTitle = (notifyRaw as { title?: unknown }).title;
  if (typeof notifyTitle !== 'string' || notifyTitle.length === 0) {
    throw new ConfigError('job.notify.title must be a non-empty string');
  }

  const provider = raw.provider;
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new ConfigError('job.provider must be a non-empty string');
  }

  return assertJobDocument({
    ...raw,
    id,
    name: notifyTitle,
    engine: 'adapter',
    adapterId: provider,
    startUrl: '',
    goal: '',
    schema: [],
    workflow: [],
    secretIds: [],
    lastResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notify: {
      title: notifyTitle,
      on: 'always',
      channel: { type: 'ntfy', topic: '' },
    },
  });
}

function coerceLegacyRun(raw: Record<string, unknown>): RunDocument {
  if (typeof raw.engine === 'string') {
    const run = raw as RunDocument;
    return {
      ...run,
      result: run.result ?? null,
    };
  }
  return {
    id: String(raw.id),
    jobId: String(raw.jobId),
    userId: String(raw.userId),
    engine: 'adapter',
    adapterId:
      typeof raw.provider === 'string' ? raw.provider : undefined,
    status: raw.status as RunDocument['status'],
    startedAt: String(raw.startedAt),
    finishedAt:
      raw.finishedAt === null || typeof raw.finishedAt === 'string'
        ? raw.finishedAt
        : null,
    durationMs:
      raw.durationMs === null || typeof raw.durationMs === 'number'
        ? raw.durationMs
        : null,
    errorCode:
      raw.errorCode === null || typeof raw.errorCode === 'string'
        ? raw.errorCode
        : null,
    errorMessage:
      raw.errorMessage === null || typeof raw.errorMessage === 'string'
        ? raw.errorMessage
        : null,
    screenshotPath:
      raw.screenshotPath === null || typeof raw.screenshotPath === 'string'
        ? raw.screenshotPath
        : null,
    recoveryAttempted: Boolean(raw.recoveryAttempted),
    recoverySucceeded: Boolean(raw.recoverySucceeded),
    overlayActivated: Boolean(raw.overlayActivated),
    result:
      raw.billSummary && typeof raw.billSummary === 'object'
        ? (raw.billSummary as Record<string, unknown>)
        : null,
  };
}

export function createBillingStoreFromCollections(
  collections: StoreCollections,
  close: () => Promise<void>,
): BillingStore {
  return {
    async getSettings() {
      const settings = await collections.settings.findOne({ id: SETTINGS_ID });
      if (!settings) {
        throw new ConfigError('Missing settings document in MongoDB');
      }
      const { id: _id, ...withoutId } = settings;
      return {
        id: SETTINGS_ID,
        ...normalizeSettings(withoutId),
      };
    },

    async listJobs(options) {
      const jobs = await collections.jobs
        .find(options?.userId ? { userId: options.userId } : {})
        .toArray();
      return jobs
        .map((job) => coerceLegacyJob(job))
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async getJob(id) {
      const job = await collections.jobs.findOne({ id });
      return job ? coerceLegacyJob(job) : null;
    },

    /** See `BillingStore.listRawJobDocuments` — deliberately bypasses `coerceLegacyJob`. */
    async listRawJobDocuments() {
      const jobs = await collections.jobs.find({}).toArray();
      return jobs.map((job) => ({ ...job }));
    },

    async upsertJob(job) {
      await collections.jobs.updateOne({ id: job.id }, { $set: job }, { upsert: true });
    },

    async upsertSettings(settings) {
      const normalized = normalizeSettings(settings);
      await collections.settings.updateOne(
        { id: SETTINGS_ID },
        {
          $set: {
            ...normalized,
            id: SETTINGS_ID,
          },
        },
        { upsert: true },
      );
    },

    async upsertSecret(secret) {
      await collections.secrets.updateOne(
        { id: secret.id },
        { $set: secret },
        { upsert: true },
      );
    },

    async listSecrets(options) {
      const secrets = await collections.secrets
        .find({
          userId: options.userId,
          ...(options.jobId !== undefined ? { jobId: options.jobId } : {}),
          ...(options.conversationId !== undefined
            ? { conversationId: options.conversationId }
            : {}),
        })
        .toArray();
      return secrets.sort((a, b) => a.key.localeCompare(b.key));
    },

    async deleteSecretsForJob(jobId) {
      await collections.secrets.deleteMany({ jobId });
    },

    async listWatches(options) {
      const watches = await collections.watches
        .find(options?.userId ? { userId: options.userId } : {})
        .toArray();
      return watches.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getWatch(id) {
      return collections.watches.findOne({ id });
    },

    async upsertWatch(watch) {
      await collections.watches.updateOne(
        { id: watch.id },
        { $set: watch },
        { upsert: true },
      );
    },

    async deleteWatch(id) {
      await collections.priceChecks.deleteMany({ watchId: id });
      await collections.watches.deleteOne({ id });
    },

    async createPriceCheck(check) {
      await collections.priceChecks.insertOne(check);
    },

    async finishPriceCheck(id, update) {
      await collections.priceChecks.updateOne({ id }, { $set: update });
    },

    async listPriceChecks(options) {
      const checks = await collections.priceChecks
        .find({
          watchId: options.watchId,
          ...(options.userId ? { userId: options.userId } : {}),
        })
        .toArray();
      const sorted = checks.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
      if (options.limit && options.limit > 0) {
        return sorted.slice(0, options.limit);
      }
      return sorted;
    },

    async listActiveOverlays(input) {
      const overlays = await collections.overlays
        .find({
          provider: input.provider,
          jobId: input.jobId,
          status: 'active',
          ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
        })
        .toArray();
      return overlays.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async recordOverlaySuccess(input: OverlaySuccessInput) {
      const existing = await collections.overlays.findOne({
        provider: input.provider,
        jobId: input.jobId,
        fingerprint: input.fingerprint,
      });

      const successCount = (existing?.successCount ?? 0) + 1;
      const status = successCount >= 3 ? 'active' : 'candidate';
      const updatedAt = nowIso();

      if (status === 'active') {
        await collections.overlays.updateMany(
          {
            provider: input.provider,
            jobId: input.jobId,
            fingerprint: input.fingerprint,
            status: 'active',
          },
          {
            $set: {
              status: 'retired',
              updatedAt,
            },
          },
        );
      }

      await collections.overlays.updateOne(
        {
          provider: input.provider,
          jobId: input.jobId,
          fingerprint: input.fingerprint,
        },
        {
          $set: {
            provider: input.provider,
            jobId: input.jobId,
            fingerprint: input.fingerprint,
            patch: input.patch,
            successCount,
            status,
            updatedAt,
          },
        },
        { upsert: true },
      );

      return {
        provider: input.provider,
        jobId: input.jobId,
        fingerprint: input.fingerprint,
        patch: input.patch,
        successCount,
        status,
        updatedAt,
      };
    },

    async createRun(run) {
      await collections.runs.insertOne(run);
    },

    async finishRun(id, update) {
      await collections.runs.updateOne({ id }, { $set: update });
    },

    async listRuns(options) {
      const runs = await collections.runs
        .find({
          ...(options?.userId ? { userId: options.userId } : {}),
          ...(options?.jobId ? { jobId: options.jobId } : {}),
        })
        .toArray();
      const sorted = runs
        .map((run) => coerceLegacyRun(run))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      if (options?.limit && options.limit > 0) {
        return sorted.slice(0, options.limit);
      }
      return sorted;
    },

    async getRun(id) {
      const run = await collections.runs.findOne({ id });
      return run ? coerceLegacyRun(run) : null;
    },

    async findUserByEmail(email) {
      return collections.users.findOne({ email: email.toLowerCase() });
    },

    async getUser(id) {
      return collections.users.findOne({ id });
    },

    async close() {
      await close();
    },
  };
}

export async function connectStore(uri: string): Promise<BillingStore> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const users = db.collection<UserDocument>('users');
  const watches = db.collection<WatchDocument>('watches');
  const priceChecks = db.collection<PriceCheckDocument>('price_checks');
  await users.createIndex({ email: 1 }, { unique: true });
  await watches.createIndex({ userId: 1 });
  await priceChecks.createIndex({ watchId: 1 });
  await priceChecks.createIndex({ watchId: 1, checkedAt: -1 });
  return createBillingStoreFromCollections(
    {
      jobs: db.collection('jobs') as unknown as CollectionLike<Record<string, unknown>>,
      settings: db.collection<SettingsDocument>('settings'),
      overlays: db.collection<OverlayDocument>('learned_overlays'),
      runs: db.collection('runs') as unknown as CollectionLike<Record<string, unknown>>,
      secrets: db.collection<SecretDocument>('secrets'),
      watches,
      priceChecks,
      users,
    },
    async () => {
      await client.close();
    },
  );
}
