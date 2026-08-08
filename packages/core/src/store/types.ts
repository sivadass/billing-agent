export type SelectorOverlayValue = string | string[];
export type SelectorOverlayPatch = Record<string, SelectorOverlayValue>;

export type JobDocument = {
  id: string;
  provider: string;
  enabled: boolean;
  schedule: string | null;
  credentialsEnv: Record<string, string>;
  notify: { title: string };
};

export type SettingsDocument = {
  id: 'default';
  ntfy: {
    baseUrl: string;
    topicEnv: string;
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

export type RunDocument = {
  id: string;
  jobId: string;
  provider: string;
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
  billSummary: Record<string, string> | null;
};

export type OverlaySuccessInput = {
  provider: string;
  jobId: string;
  fingerprint: string;
  patch: SelectorOverlayPatch;
};

export interface BillingStore {
  getSettings(): Promise<SettingsDocument>;
  listJobs(): Promise<JobDocument[]>;
  getJob(id: string): Promise<JobDocument | null>;
  upsertJob(job: JobDocument): Promise<void>;
  upsertSettings(settings: Omit<SettingsDocument, 'id'>): Promise<void>;
  listActiveOverlays(input: {
    provider: string;
    jobId: string;
    fingerprint?: string;
  }): Promise<OverlayDocument[]>;
  recordOverlaySuccess(input: OverlaySuccessInput): Promise<OverlayDocument>;
  createRun(run: RunDocument): Promise<void>;
  finishRun(id: string, update: Partial<RunDocument>): Promise<void>;
  listRuns(options?: { jobId?: string; limit?: number }): Promise<RunDocument[]>;
  getRun(id: string): Promise<RunDocument | null>;
  close(): Promise<void>;
}
