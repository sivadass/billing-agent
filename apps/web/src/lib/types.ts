export type JobDocument = {
  id: string;
  provider: string;
  enabled: boolean;
  schedule: string | null;
  credentialsEnv: Record<string, string>;
  notify: { title: string };
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
