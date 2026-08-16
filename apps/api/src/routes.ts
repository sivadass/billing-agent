import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  BillingStore,
  JobDocument,
  PriceSource,
  RunDocument,
  SecretDocument,
  SettingsDocument,
  WatchDocument,
} from '@billing-agent/core';
import {
  assertJobDocument,
  ConfigError,
  encryptSecret,
  parseMasterKey,
  verifyPassword,
} from '@billing-agent/core';
import { assertPublicHttpUrl, isWatchLocked } from '@billing-agent/price-monitor';
import { requireJwtAuth } from './auth.js';
import { signAccessToken } from './jwt.js';

export type RouteContext = {
  jwtSecret: string;
  store: BillingStore;
  onRunJob?: (jobId: string) => Promise<string>;
  onRunWatch?: (watchId: string) => Promise<string>;
  authUser?: { id: string; email: string };
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_WATCH_SCHEDULE = '0 9 * * *';

function isPriceSource(value: string): value is PriceSource {
  return (
    value === 'shopify_json' ||
    value === 'json_ld' ||
    value === 'og' ||
    value === 'selector' ||
    value === 'llm'
  );
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Parses the request body. A parse failure always raises the same fixed
 * message: `JSON.parse` puts the offending snippet in its own message, which
 * for `/jobs/:id/secrets` would reflect a plaintext secret back to the caller.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new ConfigError('Invalid request body');
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultJobDocument(userId: string): JobDocument {
  const now = new Date().toISOString();
  return {
    id: '',
    userId,
    name: '',
    enabled: true,
    schedule: null,
    startUrl: '',
    engine: 'adapter',
    goal: '',
    schema: [],
    workflow: [],
    secretIds: [],
    notify: {
      title: '',
      on: 'always',
      channel: { type: 'ntfy', topic: '' },
    },
    lastResult: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fills in the fields the caller omitted and passes everything else through
 * untouched, so `assertJobDocument` can reject a malformed supplied value
 * rather than this function silently swapping in a default.
 */
function coerceNotify(
  payload: Record<string, unknown>,
  fallback: JobDocument['notify'],
): Record<string, unknown> {
  if (payload.notify === undefined) {
    return { ...fallback };
  }
  if (!isObject(payload.notify)) {
    throw new ConfigError('job.notify must be an object');
  }
  const notify = payload.notify;
  return {
    title: notify.title === undefined ? fallback.title : notify.title,
    on: notify.on === undefined ? fallback.on : notify.on,
    channel: notify.channel === undefined ? fallback.channel : notify.channel,
  };
}

function coerceJobDocument(
  payload: unknown,
  userId: string,
  fallback?: JobDocument,
): JobDocument {
  if (!isObject(payload)) throw new ConfigError('job payload must be an object');
  const base = fallback ?? defaultJobDocument(userId);
  const now = new Date().toISOString();

  // `provider` is the pre-generic-jobs spelling of `adapterId`; still accepted
  // on the wire so older clients keep working, never stored or returned.
  const adapterId =
    payload.adapterId !== undefined
      ? payload.adapterId
      : payload.provider !== undefined
        ? payload.provider
        : base.adapterId;

  const notify = coerceNotify(payload, base.notify);
  const fallbackName =
    base.name || (typeof notify.title === 'string' ? notify.title : '');

  const job = assertJobDocument({
    id: payload.id === undefined ? base.id : payload.id,
    userId,
    name: payload.name === undefined ? fallbackName : payload.name,
    enabled: payload.enabled === undefined ? base.enabled : payload.enabled,
    schedule: payload.schedule === undefined ? base.schedule : payload.schedule,
    startUrl: payload.startUrl === undefined ? base.startUrl : payload.startUrl,
    engine: payload.engine === undefined ? base.engine : payload.engine,
    ...(adapterId === undefined ? {} : { adapterId }),
    goal: payload.goal === undefined ? base.goal : payload.goal,
    schema: payload.schema === undefined ? base.schema : payload.schema,
    workflow: payload.workflow === undefined ? base.workflow : payload.workflow,
    // Server-owned: secrets belong to PUT /jobs/:id/secrets, the result and the
    // timestamps to the worker and to this handler.
    secretIds: base.secretIds,
    notify,
    lastResult: base.lastResult,
    createdAt: base.createdAt,
    updatedAt: now,
  });

  if (job.engine === 'adapter' && !job.adapterId) {
    throw new ConfigError('job.adapterId or provider is required');
  }
  // A slash would make `/jobs/{id}` ambiguous with subresources like
  // `/jobs/{id}/secrets`.
  if (job.id.includes('/')) {
    throw new ConfigError('job.id must not contain "/"');
  }

  // SSRF: only what the caller actually sent is checked. A migrated adapter job
  // whose stored `startUrl` is a `file://` fixture stays editable as long as the
  // caller does not send a new one; a caller-supplied `file://` is rejected.
  if (payload.startUrl !== undefined) {
    if (job.startUrl) {
      assertPublicHttpUrl(job.startUrl);
    } else if (fallback) {
      // Clearing it would strand the job, and on a migrated job it would also
      // erase the only record of where it used to run.
      throw new ConfigError('job.startUrl must not be cleared');
    }
  }
  // Adapters carry their own start URL, so only a workflow needs one.
  if (job.engine === 'workflow') {
    if (!job.startUrl) {
      throw new ConfigError('job.startUrl is required for a workflow job');
    }
    // Becoming a workflow re-opens the question of where the job navigates, so
    // an inherited URL is checked too — otherwise flipping the engine would be
    // a way to promote a migrated `file://` fixture URL into a workflow job.
    // A job that was already a workflow keeps its stored URL untouched.
    if (!fallback || fallback.engine !== 'workflow') {
      assertPublicHttpUrl(job.startUrl);
    }
  }

  const channelSupplied =
    isObject(payload.notify) && payload.notify.channel !== undefined;
  if (channelSupplied) {
    if (job.notify.channel.type === 'webhook') {
      assertPublicHttpUrl(job.notify.channel.url);
    }
    // `baseUrl` is an outbound sink too: the notifier POSTs to it directly.
    if (job.notify.channel.type === 'ntfy' && job.notify.channel.baseUrl !== undefined) {
      assertPublicHttpUrl(job.notify.channel.baseUrl);
    }
  }

  return job;
}

function toJobResponse(job: JobDocument): JobDocument {
  return {
    id: job.id,
    userId: job.userId,
    name: job.name,
    enabled: job.enabled,
    schedule: job.schedule ?? null,
    startUrl: job.startUrl,
    engine: job.engine,
    ...(job.adapterId === undefined ? {} : { adapterId: job.adapterId }),
    goal: job.goal,
    schema: job.schema,
    workflow: job.workflow,
    secretIds: job.secretIds,
    notify: job.notify,
    lastResult: job.lastResult ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * Serializes only the canonical run fields, so a document still carrying
 * pre-migration `provider` / `billSummary` keys can never leak them.
 */
function toRunResponse(run: RunDocument): RunDocument {
  return {
    id: run.id,
    jobId: run.jobId,
    userId: run.userId,
    engine: run.engine,
    ...(run.adapterId === undefined ? {} : { adapterId: run.adapterId }),
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    durationMs: run.durationMs ?? null,
    errorCode: run.errorCode ?? null,
    errorMessage: run.errorMessage ?? null,
    screenshotPath: run.screenshotPath ?? null,
    recoveryAttempted: run.recoveryAttempted === true,
    recoverySucceeded: run.recoverySucceeded === true,
    overlayActivated: run.overlayActivated === true,
    result: run.result ?? null,
  };
}

function coerceWatchDocument(
  payload: unknown,
  userId: string,
  fallback?: WatchDocument,
): WatchDocument {
  if (!isObject(payload)) throw new Error('watch payload must be an object');
  const base = fallback ?? {
    id: '',
    userId,
    url: '',
    title: null,
    enabled: true,
    schedule: DEFAULT_WATCH_SCHEDULE,
    lastPrice: null,
    lastCurrency: null,
    lastSource: null,
    lastCheckedAt: null,
    createdAt: new Date().toISOString(),
  };

  const watch: WatchDocument = {
    id: typeof payload.id === 'string' ? payload.id : base.id,
    userId,
    url: typeof payload.url === 'string' ? payload.url : base.url,
    title:
      payload.title === null || typeof payload.title === 'string'
        ? payload.title
        : base.title,
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : base.enabled,
    schedule:
      payload.schedule === null || typeof payload.schedule === 'string'
        ? payload.schedule
        : base.schedule,
    lastPrice:
      typeof payload.lastPrice === 'number' || payload.lastPrice === null
        ? payload.lastPrice
        : base.lastPrice,
    lastCurrency:
      payload.lastCurrency === null || typeof payload.lastCurrency === 'string'
        ? payload.lastCurrency
        : base.lastCurrency,
    lastSource:
      payload.lastSource === null
        ? null
        : typeof payload.lastSource === 'string' && isPriceSource(payload.lastSource)
          ? payload.lastSource
          : base.lastSource,
    lastCheckedAt:
      payload.lastCheckedAt === null || typeof payload.lastCheckedAt === 'string'
        ? payload.lastCheckedAt
        : base.lastCheckedAt,
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : base.createdAt,
  };

  if (!watch.id) throw new Error('watch.id is required');
  if (!watch.url) throw new Error('watch.url is required');
  assertPublicHttpUrl(watch.url);
  return watch;
}

/**
 * Matches `/jobs/{id}/{suffix}` for a single path segment id, so a job
 * subresource is never mistaken for a job id by the `/jobs/:id` routes.
 */
function parseJobSubresourceId(pathname: string, suffix: string): string | null {
  if (!pathname.startsWith('/jobs/') || !pathname.endsWith(suffix)) return null;
  const rawId = pathname.slice('/jobs/'.length, -suffix.length);
  if (!rawId || rawId.includes('/')) return null;
  return decodeURIComponent(rawId);
}

/**
 * Parses `{ values: Record<string, string> }`. Error messages name the key
 * only — a secret value must never reach a response body or a log line.
 */
function parseSecretValues(body: unknown): Record<string, string> {
  if (!isObject(body)) {
    throw new ConfigError('request body must be an object');
  }
  if (!isObject(body.values)) {
    throw new ConfigError('values must be an object of string values');
  }
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(body.values)) {
    if (!key.trim()) {
      throw new ConfigError('values keys must be non-empty');
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new ConfigError(`values.${key} must be a non-empty string`);
    }
    values[key] = value;
  }
  return values;
}

async function listSecretKeys(
  store: BillingStore,
  userId: string,
  jobId: string,
): Promise<Array<{ key: string; set: true }>> {
  const secrets = await store.listSecrets({ userId, jobId });
  return secrets
    .map((secret) => ({ key: secret.key, set: true as const }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function handleJobSecrets(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  userId: string,
  jobId: string,
  method: string,
): Promise<void> {
  const job = await ctx.store.getJob(jobId);
  if (!job || job.userId !== userId) {
    sendJson(res, 404, { error: 'Job not found' });
    return;
  }

  if (method === 'GET') {
    sendJson(res, 200, { keys: await listSecretKeys(ctx.store, userId, jobId) });
    return;
  }

  let values: Record<string, string>;
  try {
    values = parseSecretValues(await readJsonBody(req));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }

  const recentRuns = await ctx.store.listRuns({ userId, jobId, limit: 20 });
  if (recentRuns.some((run) => run.status === 'running')) {
    sendJson(res, 409, { error: 'Job already running' });
    return;
  }

  const entries = Object.entries(values);
  if (entries.length > 0) {
    // Only touch the master key when there is something to encrypt.
    const masterKey = parseMasterKey(ctx.env ?? process.env);
    const existing = await ctx.store.listSecrets({ userId, jobId });
    const existingByKey = new Map(existing.map((secret) => [secret.key, secret]));
    const now = new Date().toISOString();

    for (const [key, value] of entries) {
      const previous = existingByKey.get(key);
      const secret: SecretDocument = {
        id: previous?.id ?? randomUUID(),
        userId,
        jobId,
        conversationId: null,
        key,
        ...encryptSecret(value, masterKey),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      await ctx.store.upsertSecret(secret);
    }

    const secretIds = (await ctx.store.listSecrets({ userId, jobId })).map(
      (secret) => secret.id,
    );
    const unchanged =
      secretIds.length === job.secretIds.length &&
      secretIds.every((id) => job.secretIds.includes(id));
    if (!unchanged) {
      await ctx.store.upsertJob({ ...job, secretIds, updatedAt: now });
      await bumpJobsGeneration(ctx.store);
    }
  }

  sendJson(res, 200, { keys: await listSecretKeys(ctx.store, userId, jobId) });
}

async function bumpJobsGeneration(store: BillingStore): Promise<void> {
  const settings = await store.getSettings();
  const { id: _id, ...withoutId } = settings;
  const updated: Omit<SettingsDocument, 'id'> = {
    ...withoutId,
    jobsGeneration: settings.jobsGeneration + 1,
    watchesGeneration: settings.watchesGeneration ?? 0,
  };
  await store.upsertSettings(updated);
}

async function bumpWatchesGeneration(store: BillingStore): Promise<void> {
  const settings = await store.getSettings();
  const { id: _id, ...withoutId } = settings;
  const updated: Omit<SettingsDocument, 'id'> = {
    ...withoutId,
    jobsGeneration: settings.jobsGeneration ?? 0,
    watchesGeneration: (settings.watchesGeneration ?? 0) + 1,
  };
  await store.upsertSettings(updated);
}

async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const invalidCredentials = () =>
    sendJson(res, 401, { error: 'Invalid email or password' });

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    // A parse error message would quote the body, password included.
    invalidCredentials();
    return;
  }
  const email = isObject(body) && typeof body.email === 'string' ? body.email.toLowerCase() : '';
  const password = isObject(body) && typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    invalidCredentials();
    return;
  }

  const user = await ctx.store.findUserByEmail(email);
  if (!user) {
    invalidCredentials();
    return;
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    invalidCredentials();
    return;
  }

  const token = await signAccessToken({
    userId: user.id,
    email: user.email,
    secret: ctx.jwtSecret,
  });

  sendJson(res, 200, { token, user: { id: user.id, email: user.email } });
}

export async function handleRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && pathname === '/auth/login') {
    await handleLogin(req, res, ctx);
    return;
  }

  const user = await requireJwtAuth(req, res, ctx.jwtSecret);
  if (!user) {
    return;
  }

  if (method === 'GET' && pathname === '/runs') {
    const jobId = url.searchParams.get('jobId') ?? undefined;
    const limitText = url.searchParams.get('limit');
    const limit = limitText ? Number(limitText) : undefined;
    const runs = await ctx.store.listRuns({
      userId: user.userId,
      jobId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    sendJson(res, 200, runs.map((run) => toRunResponse(run)));
    return;
  }

  if (method === 'GET' && pathname.startsWith('/runs/')) {
    const runId = decodeURIComponent(pathname.slice('/runs/'.length));
    const run = await ctx.store.getRun(runId);
    if (!run || run.userId !== user.userId) {
      sendJson(res, 404, { error: 'Run not found' });
      return;
    }
    sendJson(res, 200, toRunResponse(run));
    return;
  }

  if (method === 'GET' && pathname === '/jobs') {
    const jobs = await ctx.store.listJobs({ userId: user.userId });
    sendJson(res, 200, jobs.map((job) => toJobResponse(job)));
    return;
  }

  // Must stay ahead of the `/jobs/:id` routes, which would otherwise read
  // `:id/secrets` as a job id.
  if (method === 'GET' || method === 'PUT') {
    const secretsJobId = parseJobSubresourceId(pathname, '/secrets');
    if (secretsJobId) {
      await handleJobSecrets(req, res, ctx, user.userId, secretsJobId, method);
      return;
    }
  }

  if (method === 'POST' && pathname.startsWith('/jobs/') && pathname.endsWith('/run')) {
    const jobId = parseJobSubresourceId(pathname, '/run');
    if (!jobId) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (!ctx.onRunJob) {
      sendJson(res, 503, { error: 'Runner unavailable' });
      return;
    }
    const job = await ctx.store.getJob(jobId);
    if (!job || job.userId !== user.userId) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    if (!job.enabled) {
      sendJson(res, 409, { error: 'Job disabled' });
      return;
    }
    const recent = await ctx.store.listRuns({ jobId, limit: 20 });
    if (recent.some((run) => run.status === 'running')) {
      sendJson(res, 409, { error: 'Job already running' });
      return;
    }
    const runId = await ctx.onRunJob(jobId);
    sendJson(res, 202, { id: runId });
    return;
  }

  if (method === 'GET' && pathname.startsWith('/jobs/')) {
    const jobId = decodeURIComponent(pathname.slice('/jobs/'.length));
    const job = await ctx.store.getJob(jobId);
    if (!job || job.userId !== user.userId) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    sendJson(res, 200, toJobResponse(job));
    return;
  }

  if (method === 'POST' && pathname === '/jobs') {
    let job: JobDocument;
    try {
      job = coerceJobDocument(await readJsonBody(req), user.userId);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    await ctx.store.upsertJob(job);
    await bumpJobsGeneration(ctx.store);
    sendJson(res, 201, toJobResponse(job));
    return;
  }

  if (method === 'PATCH' && pathname.startsWith('/jobs/')) {
    const jobId = decodeURIComponent(pathname.slice('/jobs/'.length));
    const existing = await ctx.store.getJob(jobId);
    if (!existing || existing.userId !== user.userId) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    let merged: JobDocument;
    try {
      const body = await readJsonBody(req);
      const patch = isObject(body) ? body : {};
      // The patch is applied against `existing` as the fallback rather than
      // spread over it, so an omitted field stays omitted and only what the
      // caller supplied is validated.
      merged = coerceJobDocument({ ...patch, id: jobId }, existing.userId, existing);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    await ctx.store.upsertJob(merged);
    await bumpJobsGeneration(ctx.store);
    sendJson(res, 200, toJobResponse(merged));
    return;
  }

  if (method === 'DELETE' && pathname.startsWith('/jobs/')) {
    const jobId = decodeURIComponent(pathname.slice('/jobs/'.length));
    const existing = await ctx.store.getJob(jobId);
    if (!existing || existing.userId !== user.userId) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    const disabled = { ...existing, enabled: false };
    await ctx.store.upsertJob(disabled);
    await bumpJobsGeneration(ctx.store);
    sendJson(res, 200, toJobResponse(disabled));
    return;
  }

  if (method === 'GET' && pathname === '/watches') {
    const watches = await ctx.store.listWatches({ userId: user.userId });
    sendJson(res, 200, watches);
    return;
  }

  if (method === 'POST' && pathname === '/watches') {
    try {
      const body = await readJsonBody(req);
      const watchPayload = isObject(body) ? body : {};
      const watch = coerceWatchDocument(
        {
          ...watchPayload,
          id:
            isObject(body) && typeof body.id === 'string'
              ? body.id
              : `watch-${Date.now()}`,
          schedule:
            isObject(body) && body.schedule !== undefined
              ? body.schedule
              : DEFAULT_WATCH_SCHEDULE,
          createdAt: new Date().toISOString(),
          userId: user.userId,
          lastPrice: null,
          lastCurrency: null,
          lastSource: null,
          lastCheckedAt: null,
        },
        user.userId,
      );
      await ctx.store.upsertWatch(watch);
      await bumpWatchesGeneration(ctx.store);
      sendJson(res, 201, watch);
      return;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (method === 'GET' && pathname.startsWith('/watches/') && pathname.endsWith('/checks')) {
    const rawWatchId = pathname.slice('/watches/'.length, -'/checks'.length);
    if (!rawWatchId || rawWatchId.endsWith('/') || rawWatchId.includes('/')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const watchId = decodeURIComponent(rawWatchId);
    const watch = await ctx.store.getWatch(watchId);
    if (!watch || watch.userId !== user.userId) {
      sendJson(res, 404, { error: 'Watch not found' });
      return;
    }
    const limitText = url.searchParams.get('limit');
    const limit = limitText ? Number(limitText) : undefined;
    const checks = await ctx.store.listPriceChecks({
      watchId,
      userId: user.userId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    sendJson(res, 200, checks);
    return;
  }

  if (method === 'POST' && pathname.startsWith('/watches/') && pathname.endsWith('/check')) {
    const rawWatchId = pathname.slice('/watches/'.length, -'/check'.length);
    if (!rawWatchId || rawWatchId.endsWith('/') || rawWatchId.includes('/')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (!ctx.onRunWatch) {
      sendJson(res, 503, { error: 'Runner unavailable' });
      return;
    }
    const watchId = decodeURIComponent(rawWatchId);
    const watch = await ctx.store.getWatch(watchId);
    if (!watch || watch.userId !== user.userId) {
      sendJson(res, 404, { error: 'Watch not found' });
      return;
    }
    if (isWatchLocked(watchId)) {
      sendJson(res, 409, { error: 'Watch already running' });
      return;
    }
    const recentChecks = await ctx.store.listPriceChecks({
      watchId,
      userId: user.userId,
      limit: 20,
    });
    if (recentChecks.some((check) => check.status === 'running')) {
      sendJson(res, 409, { error: 'Watch already running' });
      return;
    }
    try {
      const checkId = await ctx.onRunWatch(watchId);
      sendJson(res, 202, { id: checkId });
      return;
    } catch (error) {
      if (error instanceof Error && /already running/i.test(error.message)) {
        sendJson(res, 409, { error: 'Watch already running' });
        return;
      }
      throw error;
    }
  }

  if (method === 'GET' && pathname.startsWith('/watches/')) {
    const watchId = decodeURIComponent(pathname.slice('/watches/'.length));
    const watch = await ctx.store.getWatch(watchId);
    if (!watch || watch.userId !== user.userId) {
      sendJson(res, 404, { error: 'Watch not found' });
      return;
    }
    sendJson(res, 200, watch);
    return;
  }

  if (method === 'PATCH' && pathname.startsWith('/watches/')) {
    const watchId = decodeURIComponent(pathname.slice('/watches/'.length));
    const existing = await ctx.store.getWatch(watchId);
    if (!existing || existing.userId !== user.userId) {
      sendJson(res, 404, { error: 'Watch not found' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const merged = coerceWatchDocument(
        { ...existing, ...(isObject(body) ? body : {}), id: watchId },
        existing.userId,
        existing,
      );
      await ctx.store.upsertWatch(merged);
      await bumpWatchesGeneration(ctx.store);
      sendJson(res, 200, merged);
      return;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (method === 'DELETE' && pathname.startsWith('/watches/')) {
    const watchId = decodeURIComponent(pathname.slice('/watches/'.length));
    const existing = await ctx.store.getWatch(watchId);
    if (!existing || existing.userId !== user.userId) {
      sendJson(res, 404, { error: 'Watch not found' });
      return;
    }
    await ctx.store.deleteWatch(watchId);
    await bumpWatchesGeneration(ctx.store);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}
