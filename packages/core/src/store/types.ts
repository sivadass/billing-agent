import type { WorkflowStep } from '../workflow/types.js';

export type SelectorOverlayValue = string | string[];
export type SelectorOverlayPatch = Record<string, SelectorOverlayValue>;

export type JobEngine = 'workflow' | 'adapter';
export type FieldType = 'string' | 'number' | 'price' | 'date';
export type NotifyOn = 'always' | 'change' | 'drop' | 'failure_only';
export type NotifyChannel =
  | { type: 'ntfy'; topic: string; baseUrl?: string }
  | { type: 'webhook'; url: string };

export type ExtractField = { key: string; label: string; type: FieldType };

export type JobDocument = {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  startUrl: string;
  engine: JobEngine;
  adapterId?: string;
  goal: string;
  schema: ExtractField[];
  workflow: WorkflowStep[];
  secretIds: string[];
  notify: { title: string; on: NotifyOn; channel: NotifyChannel };
  lastResult: Record<string, string | number> | null;
  createdAt: string;
  updatedAt: string;
};

export type SecretDocument = {
  id: string;
  userId: string;
  jobId: string | null;
  conversationId: string | null;
  key: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: string;
  updatedAt: string;
};

export type UserDocument = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

export type SettingsDocument = {
  id: 'default';
  ntfy: {
    baseUrl: string;
    topicEnv?: string;
    defaultTopic?: string;
    priority: string;
  };
  mistral: {
    apiKeyEnv: string;
    model: string;
  };
  browser: {
    headless: boolean;
    timeoutMs: number;
    saveErrorScreenshot: boolean;
    noSandbox?: boolean;
  };
  jobsGeneration: number;
  watchesGeneration?: number;
};

export type OverlayStatus = 'candidate' | 'active' | 'retired';

export type OverlayDocument = {
  provider: string;
  jobId: string;
  fingerprint: string;
  patch: SelectorOverlayPatch;
  successCount: number;
  status: OverlayStatus;
  updatedAt: string;
};

export type ConversationStatus =
  | 'active'
  | 'awaiting_secret'
  | 'confirming'
  | 'saved'
  | 'abandoned'
  | 'expired';

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  screenshotPath?: string;
  createdAt: string;
};

export type ConversationDocument = {
  id: string;
  userId: string;
  status: ConversationStatus;
  jobId: string | null;
  startUrl: string | null;
  goal: string | null;
  messages: ConversationMessage[];
  draftWorkflow: WorkflowStep[] | null;
  draftSchema: ExtractField[] | null;
  draftExtract: Record<string, string | number> | null;
  draftNotify: JobDocument['notify'] | null;
  /** Optional schedule from POST /conversations; applied when the job is saved. */
  draftSchedule: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunDocument = {
  id: string;
  jobId: string;
  userId: string;
  engine: JobEngine;
  adapterId?: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  screenshotPath: string | null;
  recoveryAttempted: boolean;
  recoverySucceeded: boolean;
  overlayActivated: boolean;
  result: Record<string, unknown> | null;
};

export type PriceSource =
  | 'shopify_json'
  | 'json_ld'
  | 'og'
  | 'selector'
  | 'llm';

export type WatchDocument = {
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

export type PriceCheckDocument = {
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

export type OverlaySuccessInput = {
  provider: string;
  jobId: string;
  fingerprint: string;
  patch: SelectorOverlayPatch;
};

export interface BillingStore {
  getSettings(): Promise<SettingsDocument>;
  listJobs(options?: { userId?: string }): Promise<JobDocument[]>;
  getJob(id: string): Promise<JobDocument | null>;
  /**
   * Migration-only escape hatch: every job document exactly as persisted,
   * with **no** legacy-compatibility coercion applied (unlike `listJobs`,
   * which always runs raw Mongo documents through `coerceLegacyJob`, so a
   * legacy `{ provider, credentialsEnv }` job always reads back with
   * `engine`/`adapterId` already set and `provider`/`credentialsEnv`
   * stripped). `migrateGenericJobs` needs this to (a) tell a genuinely
   * already-migrated job apart from `coerceLegacyJob`'s read-time shim, and
   * (b) recover `provider` / `credentialsEnv` to encrypt into `secrets`.
   * Never used by ordinary reads (API, job-runner, scheduler) — those keep
   * using `listJobs` / `getJob` unchanged.
   *
   * Optional: omit when `listJobs()` already returns documents with no
   * hidden/coerced fields (e.g. a plain in-memory test store) — callers
   * should fall back to `listJobs()` in that case.
   */
  listRawJobDocuments?(): Promise<Record<string, unknown>[]>;
  upsertJob(job: JobDocument): Promise<void>;
  upsertSettings(settings: Omit<SettingsDocument, 'id'>): Promise<void>;
  upsertSecret(secret: SecretDocument): Promise<void>;
  listSecrets(options: {
    userId: string;
    jobId?: string;
    conversationId?: string;
  }): Promise<SecretDocument[]>;
  deleteSecretsForJob(jobId: string): Promise<void>;
  upsertConversation(conversation: ConversationDocument): Promise<void>;
  getConversation(id: string): Promise<ConversationDocument | null>;
  listConversations(options?: {
    userId?: string;
    status?: ConversationStatus | ConversationStatus[];
  }): Promise<ConversationDocument[]>;
  listWatches(options?: { userId?: string }): Promise<WatchDocument[]>;
  getWatch(id: string): Promise<WatchDocument | null>;
  upsertWatch(watch: WatchDocument): Promise<void>;
  deleteWatch(id: string): Promise<void>;
  createPriceCheck(check: PriceCheckDocument): Promise<void>;
  finishPriceCheck(id: string, update: Partial<PriceCheckDocument>): Promise<void>;
  listPriceChecks(options: {
    watchId: string;
    userId?: string;
    limit?: number;
  }): Promise<PriceCheckDocument[]>;
  listActiveOverlays(input: {
    provider: string;
    jobId: string;
    fingerprint?: string;
  }): Promise<OverlayDocument[]>;
  recordOverlaySuccess(input: OverlaySuccessInput): Promise<OverlayDocument>;
  createRun(run: RunDocument): Promise<void>;
  finishRun(id: string, update: Partial<RunDocument>): Promise<void>;
  listRuns(options?: {
    userId?: string;
    jobId?: string;
    limit?: number;
  }): Promise<RunDocument[]>;
  getRun(id: string): Promise<RunDocument | null>;
  findUserByEmail(email: string): Promise<UserDocument | null>;
  getUser(id: string): Promise<UserDocument | null>;
  close(): Promise<void>;
}
