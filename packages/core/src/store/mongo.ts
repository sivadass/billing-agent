import { MongoClient } from 'mongodb';
import { ConfigError } from '../errors.js';
import type {
  BillingStore,
  JobDocument,
  OverlayDocument,
  OverlaySuccessInput,
  RunDocument,
  SettingsDocument,
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
};

type StoreCollections = {
  jobs: CollectionLike<JobDocument>;
  settings: CollectionLike<SettingsDocument>;
  overlays: CollectionLike<OverlayDocument>;
  runs: CollectionLike<RunDocument>;
};

function nowIso(): string {
  return new Date().toISOString();
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
      return settings;
    },

    async listJobs() {
      const jobs = await collections.jobs.find({}).toArray();
      return jobs.sort((a, b) => a.id.localeCompare(b.id));
    },

    async getJob(id) {
      return collections.jobs.findOne({ id });
    },

    async upsertJob(job) {
      await collections.jobs.updateOne({ id: job.id }, { $set: job }, { upsert: true });
    },

    async upsertSettings(settings) {
      await collections.settings.updateOne(
        { id: SETTINGS_ID },
        {
          $set: {
            ...settings,
            id: SETTINGS_ID,
            jobsGeneration: settings.jobsGeneration ?? 0,
          },
        },
        { upsert: true },
      );
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
        .find(options?.jobId ? { jobId: options.jobId } : {})
        .toArray();
      const sorted = runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      if (options?.limit && options.limit > 0) {
        return sorted.slice(0, options.limit);
      }
      return sorted;
    },

    async getRun(id) {
      return collections.runs.findOne({ id });
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
  return createBillingStoreFromCollections(
    {
      jobs: db.collection<JobDocument>('jobs'),
      settings: db.collection<SettingsDocument>('settings'),
      overlays: db.collection<OverlayDocument>('learned_overlays'),
      runs: db.collection<RunDocument>('runs'),
    },
    async () => {
      await client.close();
    },
  );
}
