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

export type PriceSource = 'shopify_json' | 'json_ld' | 'og' | 'selector' | 'llm';

export type WatchDocument = {
  id: string;
  userId?: string;
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
  userId?: string;
  status: 'running' | 'success' | 'failed';
  price: number | null;
  currency: string | null;
  source: PriceSource | null;
  previousPrice: number | null;
  dropped: boolean | null;
  error: string | null;
  checkedAt: string;
};
