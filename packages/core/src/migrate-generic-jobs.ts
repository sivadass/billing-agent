import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Db } from 'mongodb';
import { ConfigError } from './errors.js';
import { encryptSecret, parseMasterKey } from './secrets.js';
import { assertJobDocument } from './store/assert-job.js';
import type {
  BillingStore,
  ExtractField,
  JobDocument,
  PriceSource,
  RunDocument,
  SecretDocument,
  SettingsDocument,
} from './store/types.js';
import type { WorkflowStep } from './workflow/types.js';

export type MigrateGenericJobsResult = {
  jobsMigrated: number;
  watchesMigrated: number;
  runsMigrated: number;
  legacyCollectionsDropped: boolean;
};

/** Legacy watch shape read from the pre-migration `watches` collection only. */
export type LegacyWatch = {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  enabled: boolean;
  schedule: string | null;
  lastPrice: number | null;
  lastCurrency: string | null;
  lastSource: PriceSource | null;
  lastCheckedAt: string | null;
  createdAt: string;
};

/** Legacy price check shape read from the pre-migration `price_checks` collection only. */
export type LegacyPriceCheck = {
  id: string;
  watchId: string;
  userId: string;
  status: 'running' | 'success' | 'failed';
  price: number | null;
  currency: string | null;
  source: PriceSource | null;
  previousPrice: number | null;
  dropped: boolean | null;
  error: string | null;
  checkedAt: string;
};

export type LegacyMigrationSource = {
  listWatches(): Promise<LegacyWatch[]>;
  listPriceChecks(watchId: string): Promise<LegacyPriceCheck[]>;
  dropCollections(): Promise<void>;
};

export function createMongoLegacyMigrationSource(db: Db): LegacyMigrationSource {
  const watches = db.collection<LegacyWatch>('watches');
  const priceChecks = db.collection<LegacyPriceCheck>('price_checks');
  return {
    async listWatches() {
      return watches.find().toArray();
    },
    async listPriceChecks(watchId) {
      return priceChecks.find({ watchId }).toArray();
    },
    async dropCollections() {
      const existing = await db.listCollections().toArray();
      const names = new Set(existing.map((collection) => collection.name));
      if (names.has('watches')) {
        await watches.drop();
      }
      if (names.has('price_checks')) {
        await priceChecks.drop();
      }
    },
  };
}

type LegacyBillingJobDoc = {
  id: string;
  userId?: unknown;
  provider: string;
  enabled?: unknown;
  schedule?: unknown;
  credentialsEnv?: Record<string, string>;
  notify?: { title?: string };
};

/**
 * Locked TNPDCL login URL (see `adapters/tnpdcl.ts`). Dummy's default fixture
 * path mirrors `adapters/dummy.ts`'s own fallback so a migrated dummy job
 * points at the same `file://` URL the adapter would use with no
 * `fixturePath` override.
 */
const TNPDCL_START_URL = 'https://www.tnebnet.org/awp/login';
const DUMMY_START_URL = pathToFileURL(
  resolve(process.cwd(), 'fixtures/dummy-bill.html'),
).href;

const ADAPTER_START_URLS: Record<string, string> = {
  tnpdcl: TNPDCL_START_URL,
  dummy: DUMMY_START_URL,
};

/** Spec: "schema ← amount, dueDate, billPeriod, status, accountLabel". */
const ADAPTER_SCHEMA: ExtractField[] = [
  { key: 'amount', label: 'Amount', type: 'price' },
  { key: 'dueDate', label: 'Due Date', type: 'date' },
  { key: 'billPeriod', label: 'Bill Period', type: 'string' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'accountLabel', label: 'Account', type: 'string' },
];

const WATCH_SCHEMA: ExtractField[] = [
  { key: 'price', label: 'Price', type: 'price' },
  { key: 'currency', label: 'Currency', type: 'string' },
];

function isUnmigratedJob(raw: unknown): raw is LegacyBillingJobDoc {
  const job = raw as Record<string, unknown>;
  return typeof job.engine !== 'string';
}

/**
 * Preflight for a job the migration is about to skip because it already carries
 * `engine`. Such a document can predate the write-time validation, so checking
 * it here surfaces the problem during the documented migration step instead of
 * the next time `GET /jobs` tries to list it. Nothing is rewritten: the operator
 * fixes the document and re-runs.
 */
function assertMigratedJobIsValid(raw: Record<string, unknown>): void {
  try {
    assertJobDocument(raw);
  } catch (error) {
    throw new ConfigError(
      `Job "${String(raw.id)}" is already migrated but invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

/**
 * Prefers the migration-only `listRawJobDocuments` (uncoerced) so a real
 * Mongo-backed store's legacy `{ provider, credentialsEnv }` jobs are
 * visible as-is. Falls back to `listJobs()` for stores that don't implement
 * it — safe only because those stores (e.g. a plain in-memory test double)
 * don't apply any read-time coercion in the first place, so `listJobs()`
 * already returns raw documents.
 */
async function fetchRawJobDocuments(
  store: BillingStore,
): Promise<Record<string, unknown>[]> {
  if (store.listRawJobDocuments) {
    return store.listRawJobDocuments();
  }
  return (await store.listJobs()) as unknown as Record<string, unknown>[];
}

function isMigratedJob(raw: JobDocument | null): boolean {
  return raw !== null && typeof (raw as unknown as Record<string, unknown>).engine === 'string';
}

/**
 * Best-effort resolution of the "current resolved global topic" for the
 * migration mapping. Unlike `config.ts`'s `resolveNtfyTopic`, this never
 * throws — an unresolved topic just becomes `''`, which the job runner
 * already falls back to `settings.ntfy` / `NTFY_TOPIC` for at run time.
 */
function resolveGlobalNtfyTopic(
  ntfy: SettingsDocument['ntfy'],
  env: NodeJS.ProcessEnv,
): string {
  if (ntfy.topicEnv) {
    const fromTopicEnv = env[ntfy.topicEnv];
    if (fromTopicEnv) return fromTopicEnv;
  }
  if (ntfy.defaultTopic) return ntfy.defaultTopic;
  const fromEnv = env.NTFY_TOPIC;
  return typeof fromEnv === 'string' ? fromEnv : '';
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

type MigrationContext = {
  store: BillingStore;
  env: NodeJS.ProcessEnv;
  resolvedTopic: string;
  nowIso: string;
  getMasterKey: () => Buffer;
};

async function migrateBillingJob(
  raw: LegacyBillingJobDoc,
  ctx: MigrationContext,
): Promise<void> {
  if (typeof raw.provider !== 'string' || raw.provider.length === 0) {
    throw new ConfigError(`Legacy job ${String(raw.id)} is missing "provider"`);
  }
  const notifyTitle = raw.notify?.title;
  if (typeof notifyTitle !== 'string' || notifyTitle.length === 0) {
    throw new ConfigError(`Legacy job ${raw.id} is missing "notify.title"`);
  }

  const userId = typeof raw.userId === 'string' ? raw.userId : '';
  const credentialsEnv = Object.entries(raw.credentialsEnv ?? {});

  // Validate every referenced env var resolves *before* touching the store,
  // so a job with a missing/empty credential never partially migrates (no
  // orphan secret rows, no job persisted with `engine` set but credentials
  // it can't actually run with). The error names the env var, never a value.
  for (const [fieldKey, envName] of credentialsEnv) {
    const value = ctx.env[envName];
    if (!value) {
      throw new ConfigError(
        `Missing environment variable "${envName}" (job "${raw.id}" credentialsEnv.${fieldKey}); cannot migrate this job's credentials`,
      );
    }
  }

  const secretIds: string[] = [];
  for (const [fieldKey, envName] of credentialsEnv) {
    const value = ctx.env[envName] as string;
    const { ciphertext, iv, tag } = encryptSecret(value, ctx.getMasterKey());
    const secret: SecretDocument = {
      id: randomUUID(),
      userId,
      jobId: raw.id,
      conversationId: null,
      key: fieldKey,
      ciphertext,
      iv,
      tag,
      createdAt: ctx.nowIso,
      updatedAt: ctx.nowIso,
    };
    await ctx.store.upsertSecret(secret);
    secretIds.push(secret.id);
  }

  const job: JobDocument = {
    id: raw.id,
    userId,
    name: notifyTitle,
    enabled: raw.enabled === true,
    schedule: typeof raw.schedule === 'string' ? raw.schedule : null,
    startUrl: ADAPTER_START_URLS[raw.provider] ?? '',
    engine: 'adapter',
    adapterId: raw.provider,
    goal: notifyTitle,
    schema: ADAPTER_SCHEMA,
    workflow: [],
    secretIds,
    notify: {
      title: notifyTitle,
      on: 'always',
      channel: { type: 'ntfy', topic: ctx.resolvedTopic },
    },
    lastResult: null,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };

  await ctx.store.upsertJob(job);
}

/**
 * Deterministic workflow: `goto` the watch URL, then one `extract` step that
 * tries `shopify_json` first and falls back to the generic `price` strategy
 * (the interpreter — slice 2 — walks fields in order and keeps the first hit
 * per key). Not runnable until the interpreter exists.
 */
function watchWorkflowSteps(url: string): WorkflowStep[] {
  return [
    { id: 'goto-watch', type: 'goto', url },
    {
      id: 'extract-price',
      type: 'extract',
      fields: [
        { key: 'price', strategy: 'shopify_json' },
        { key: 'currency', strategy: 'shopify_json' },
        { key: 'price', strategy: 'price' },
      ],
    },
  ];
}

function watchLastResult(
  watch: LegacyWatch,
): Record<string, string | number> | null {
  if (watch.lastPrice === null) return null;
  return {
    price: watch.lastPrice,
    ...(watch.lastCurrency !== null ? { currency: watch.lastCurrency } : {}),
  };
}

function watchToWorkflowJob(watch: LegacyWatch, ctx: MigrationContext): JobDocument {
  const name = watch.title ?? safeHostname(watch.url);
  return {
    id: watch.id,
    userId: watch.userId,
    name,
    enabled: watch.enabled,
    schedule: watch.schedule,
    startUrl: watch.url,
    engine: 'workflow',
    goal: name,
    schema: WATCH_SCHEMA,
    workflow: watchWorkflowSteps(watch.url),
    secretIds: [],
    notify: {
      title: name,
      on: 'drop',
      channel: { type: 'ntfy', topic: ctx.resolvedTopic },
    },
    lastResult: watchLastResult(watch),
    createdAt: watch.createdAt,
    updatedAt: ctx.nowIso,
  };
}

function priceCheckToRun(check: LegacyPriceCheck, jobId: string): RunDocument {
  const running = check.status === 'running';
  const result: Record<string, unknown> | null =
    check.status === 'success'
      ? {
          ...(check.price !== null ? { price: check.price } : {}),
          ...(check.currency !== null ? { currency: check.currency } : {}),
        }
      : null;

  return {
    id: check.id,
    jobId,
    userId: check.userId,
    engine: 'workflow',
    status: check.status,
    startedAt: check.checkedAt,
    finishedAt: running ? null : check.checkedAt,
    durationMs: null,
    errorCode: check.error ? 'ScrapeError' : null,
    errorMessage: check.error,
    screenshotPath: null,
    recoveryAttempted: false,
    recoverySucceeded: false,
    overlayActivated: false,
    result,
  };
}

async function allLegacyWatchesMigrated(
  store: BillingStore,
  legacy: LegacyMigrationSource,
): Promise<boolean> {
  for (const watch of await legacy.listWatches()) {
    const existingJob = await store.getJob(watch.id);
    if (!isMigratedJob(existingJob)) {
      return false;
    }
  }
  return true;
}

/**
 * Idempotent Slice 1 migration (see docs/superpowers/specs/2026-08-16-generic-site-jobs-design.md#migration):
 *  - legacy billing jobs (`provider` present, no `engine`) → `engine: 'adapter'`
 *    jobs, `credentialsEnv` values copied from `env` into encrypted `secrets`
 *  - watches → `engine: 'workflow'` jobs (not runnable until the slice 2
 *    interpreter exists)
 *  - `price_checks` → `runs`
 *  - settings: keep `ntfy.baseUrl` / `priority` / `jobsGeneration`; drop the
 *    required `topicEnv` and `watchesGeneration`
 *
 * When `legacy` is provided and every watch has a corresponding migrated job,
 * drops the leftover `watches` and `price_checks` collections. Safe to run
 * repeatedly: already-migrated jobs (raw doc already has `engine`), watches
 * with an existing workflow job, and price_checks with an existing run are
 * all skipped.
 */
export async function migrateGenericJobs(input: {
  store: BillingStore;
  env: NodeJS.ProcessEnv;
  now?: Date;
  legacy?: LegacyMigrationSource;
}): Promise<MigrateGenericJobsResult> {
  const { store, env, legacy } = input;
  const nowIso = (input.now ?? new Date()).toISOString();

  const settings = await store.getSettings();
  const resolvedTopic = resolveGlobalNtfyTopic(settings.ntfy, env);

  let masterKey: Buffer | undefined;
  const ctx: MigrationContext = {
    store,
    env,
    resolvedTopic,
    nowIso,
    getMasterKey: () => {
      if (!masterKey) masterKey = parseMasterKey(env);
      return masterKey;
    },
  };

  let jobsMigrated = 0;
  for (const job of await fetchRawJobDocuments(store)) {
    if (!isUnmigratedJob(job)) {
      assertMigratedJobIsValid(job);
      continue;
    }
    await migrateBillingJob(job, ctx);
    jobsMigrated += 1;
  }

  let watchesMigrated = 0;
  let runsMigrated = 0;
  if (legacy) {
    for (const watch of await legacy.listWatches()) {
      const existingJob = await store.getJob(watch.id);
      if (!isMigratedJob(existingJob)) {
        await store.upsertJob(watchToWorkflowJob(watch, ctx));
        watchesMigrated += 1;
      }

      for (const check of await legacy.listPriceChecks(watch.id)) {
        const existingRun = await store.getRun(check.id);
        if (existingRun) continue;
        await store.createRun(priceCheckToRun(check, watch.id));
        runsMigrated += 1;
      }
    }
  }

  await store.upsertSettings({
    ntfy: {
      baseUrl: settings.ntfy.baseUrl,
      priority: settings.ntfy.priority,
      ...(resolvedTopic ? { defaultTopic: resolvedTopic } : {}),
    },
    mistral: settings.mistral,
    browser: settings.browser,
    jobsGeneration: settings.jobsGeneration,
  });

  let legacyCollectionsDropped = false;
  if (legacy && (await allLegacyWatchesMigrated(store, legacy))) {
    await legacy.dropCollections();
    legacyCollectionsDropped = true;
  }

  return { jobsMigrated, watchesMigrated, runsMigrated, legacyCollectionsDropped };
}
