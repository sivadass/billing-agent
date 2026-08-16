export type JobEngine = 'workflow' | 'adapter';

export type FieldType = 'string' | 'number' | 'price' | 'date';

export type ExtractField = {
  key: string;
  label: string;
  type: FieldType;
};

export type NotifyOn = 'always' | 'change' | 'drop' | 'failure_only';

export type NotifyChannel =
  | { type: 'ntfy'; topic: string; baseUrl?: string }
  | { type: 'webhook'; url: string };

/** Mirrors the canonical core `JobDocument`; workflow steps stay opaque here. */
export type JobDocument = {
  id: string;
  userId?: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  startUrl: string;
  engine: JobEngine;
  adapterId?: string;
  goal: string;
  schema: ExtractField[];
  workflow: unknown[];
  secretIds: string[];
  notify: {
    title: string;
    on: NotifyOn;
    channel: NotifyChannel;
  };
  lastResult: Record<string, string | number> | null;
  createdAt: string;
  updatedAt: string;
};

/** `PATCH /jobs/:id` only ever edits these; the rest is owned by the worker. */
export type JobPatch = {
  name: string;
  enabled: boolean;
  schedule: string | null;
  notify: JobDocument['notify'];
};

/** `GET /jobs/:id/secrets` — which keys exist, never their values. */
export type JobSecretKey = {
  key: string;
  set: true;
};

export type RunDocument = {
  id: string;
  jobId: string;
  userId?: string;
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
