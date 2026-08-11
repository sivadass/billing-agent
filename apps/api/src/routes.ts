import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  BillingStore,
  JobDocument,
  PriceSource,
  SettingsDocument,
  WatchDocument,
} from '@billing-agent/core';
import { verifyPassword } from '@billing-agent/core';
import { assertPublicHttpUrl, isWatchLocked } from '@billing-agent/price-monitor';
import { requireJwtAuth } from './auth.js';
import { signAccessToken } from './jwt.js';

export type RouteContext = {
  jwtSecret: string;
  store: BillingStore;
  onRunJob?: (jobId: string) => Promise<string>;
  onRunWatch?: (watchId: string) => Promise<string>;
  authUser?: { id: string; email: string };
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

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coerceJobDocument(
  payload: unknown,
  userId: string,
  fallback?: JobDocument,
): JobDocument {
  if (!isObject(payload)) throw new Error('job payload must be an object');
  const base = fallback ?? {
    id: '',
    userId,
    provider: '',
    enabled: true,
    schedule: null,
    credentialsEnv: {},
    notify: { title: '' },
  };

  const job: JobDocument = {
    id: typeof payload.id === 'string' ? payload.id : base.id,
    userId,
    provider: typeof payload.provider === 'string' ? payload.provider : base.provider,
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : base.enabled,
    schedule:
      payload.schedule === null || typeof payload.schedule === 'string'
        ? payload.schedule
        : base.schedule,
    credentialsEnv: isObject(payload.credentialsEnv)
      ? Object.fromEntries(
          Object.entries(payload.credentialsEnv).map(([key, value]) => [
            key,
            String(value),
          ]),
        )
      : base.credentialsEnv,
    notify:
      isObject(payload.notify) && typeof payload.notify.title === 'string'
        ? { title: payload.notify.title }
        : base.notify,
  };

  if (!job.id) throw new Error('job.id is required');
  if (!job.provider) throw new Error('job.provider is required');
  if (!job.notify.title) throw new Error('job.notify.title is required');
  return job;
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
  const body = await readJsonBody(req);
  const email = isObject(body) && typeof body.email === 'string' ? body.email.toLowerCase() : '';
  const password = isObject(body) && typeof body.password === 'string' ? body.password : '';

  const invalidCredentials = () =>
    sendJson(res, 401, { error: 'Invalid email or password' });

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
    sendJson(res, 200, runs);
    return;
  }

  if (method === 'GET' && pathname.startsWith('/runs/')) {
    const runId = decodeURIComponent(pathname.slice('/runs/'.length));
    const run = await ctx.store.getRun(runId);
    if (!run || run.userId !== user.userId) {
      sendJson(res, 404, { error: 'Run not found' });
      return;
    }
    sendJson(res, 200, run);
    return;
  }

  if (method === 'GET' && pathname === '/jobs') {
    const jobs = await ctx.store.listJobs({ userId: user.userId });
    sendJson(res, 200, jobs);
    return;
  }

  if (method === 'POST' && pathname.startsWith('/jobs/') && pathname.endsWith('/run')) {
    const rawJobId = pathname.slice('/jobs/'.length, -'/run'.length);
    if (!rawJobId || rawJobId.endsWith('/') || rawJobId.includes('/')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const jobId = decodeURIComponent(rawJobId);
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
    sendJson(res, 200, job);
    return;
  }

  if (method === 'POST' && pathname === '/jobs') {
    const body = await readJsonBody(req);
    const job = coerceJobDocument(body, user.userId);
    await ctx.store.upsertJob(job);
    await bumpJobsGeneration(ctx.store);
    sendJson(res, 201, job);
    return;
  }

  if (method === 'PATCH' && pathname.startsWith('/jobs/')) {
    const jobId = decodeURIComponent(pathname.slice('/jobs/'.length));
    const existing = await ctx.store.getJob(jobId);
    if (!existing || existing.userId !== user.userId) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    const body = await readJsonBody(req);
    const patch = isObject(body) ? body : {};
    const merged = coerceJobDocument(
      { ...existing, ...patch, id: jobId },
      existing.userId,
      existing,
    );
    await ctx.store.upsertJob(merged);
    await bumpJobsGeneration(ctx.store);
    sendJson(res, 200, merged);
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
    sendJson(res, 200, disabled);
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
