import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BillingStore, JobDocument, SettingsDocument } from '@billing-agent/core';
import { requireBearerAuth } from './auth.js';

export type RouteContext = {
  token: string;
  store: BillingStore;
};

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

function coerceJobDocument(payload: unknown, fallback?: JobDocument): JobDocument {
  if (!isObject(payload)) throw new Error('job payload must be an object');
  const base = fallback ?? {
    id: '',
    provider: '',
    enabled: true,
    schedule: null,
    credentialsEnv: {},
    notify: { title: '' },
  };

  const job: JobDocument = {
    id: typeof payload.id === 'string' ? payload.id : base.id,
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

async function bumpJobsGeneration(store: BillingStore): Promise<void> {
  const settings = await store.getSettings();
  const { id: _id, ...withoutId } = settings;
  const updated: Omit<SettingsDocument, 'id'> = {
    ...withoutId,
    jobsGeneration: settings.jobsGeneration + 1,
  };
  await store.upsertSettings(updated);
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

  if (!requireBearerAuth(req, res, ctx.token)) {
    return;
  }

  if (method === 'GET' && pathname === '/runs') {
    const jobId = url.searchParams.get('jobId') ?? undefined;
    const limitText = url.searchParams.get('limit');
    const limit = limitText ? Number(limitText) : undefined;
    const runs = await ctx.store.listRuns({
      jobId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    sendJson(res, 200, runs);
    return;
  }

  if (method === 'GET' && pathname.startsWith('/runs/')) {
    const runId = decodeURIComponent(pathname.slice('/runs/'.length));
    const run = await ctx.store.getRun(runId);
    if (!run) {
      sendJson(res, 404, { error: 'Run not found' });
      return;
    }
    sendJson(res, 200, run);
    return;
  }

  if (method === 'GET' && pathname === '/jobs') {
    const jobs = await ctx.store.listJobs();
    sendJson(res, 200, jobs);
    return;
  }

  if (method === 'GET' && pathname.startsWith('/jobs/')) {
    const jobId = decodeURIComponent(pathname.slice('/jobs/'.length));
    const job = await ctx.store.getJob(jobId);
    if (!job) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (method === 'POST' && pathname === '/jobs') {
    const body = await readJsonBody(req);
    const job = coerceJobDocument(body);
    await ctx.store.upsertJob(job);
    await bumpJobsGeneration(ctx.store);
    sendJson(res, 201, job);
    return;
  }

  if (method === 'PATCH' && pathname.startsWith('/jobs/')) {
    const jobId = decodeURIComponent(pathname.slice('/jobs/'.length));
    const existing = await ctx.store.getJob(jobId);
    if (!existing) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    const body = await readJsonBody(req);
    const merged = coerceJobDocument({ ...existing, ...body, id: jobId }, existing);
    await ctx.store.upsertJob(merged);
    await bumpJobsGeneration(ctx.store);
    sendJson(res, 200, merged);
    return;
  }

  if (method === 'DELETE' && pathname.startsWith('/jobs/')) {
    const jobId = decodeURIComponent(pathname.slice('/jobs/'.length));
    const existing = await ctx.store.getJob(jobId);
    if (!existing) {
      sendJson(res, 404, { error: 'Job not found' });
      return;
    }
    const disabled = { ...existing, enabled: false };
    await ctx.store.upsertJob(disabled);
    await bumpJobsGeneration(ctx.store);
    sendJson(res, 200, disabled);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}
