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

export type ConversationStatus =
  | 'active'
  | 'awaiting_secret'
  | 'confirming'
  | 'saved'
  | 'abandoned'
  | 'expired';

export type ConversationSummary = {
  id: string;
  status: ConversationStatus;
  goal: string | null;
  startUrl: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  screenshotPath?: string;
  screenshotUrl?: string;
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
  draftWorkflow: unknown[] | null;
  draftSchema: ExtractField[] | null;
  draftExtract: Record<string, string | number> | null;
  draftNotify: JobDocument['notify'] | null;
  draftSchedule: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateConversationInput = {
  startUrl: string;
  goal: string;
  schedule?: string | null;
  notify?: JobDocument['notify'];
};

export type ConfirmConversationResponse = {
  jobId: string;
  conversationId: string;
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
  screenshotUrl?: string;
  recoveryAttempted: boolean;
  recoverySucceeded: boolean;
  overlayActivated: boolean;
  result: Record<string, unknown> | null;
};
