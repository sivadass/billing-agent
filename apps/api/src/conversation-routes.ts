import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  BillingStore,
  ConversationDocument,
  ConversationMessage,
  JobDocument,
  SecretDocument,
  SettingsDocument,
} from '@billing-agent/core';
import {
  assertJobDocument,
  assertPublicHttpUrl,
  ConfigError,
  decryptSecret,
  encryptSecret,
  parseMasterKey,
} from '@billing-agent/core';
import type { RouteContext } from './routes.js';

export type ConversationRouteContext = RouteContext & {
  onAuthorConversation?: (conversationId: string) => Promise<void>;
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
  try {
    return JSON.parse(text);
  } catch {
    throw new ConfigError('Invalid request body');
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConversationSubresourceId(pathname: string, suffix: string): string | null {
  if (!pathname.startsWith('/conversations/') || !pathname.endsWith(suffix)) {
    return null;
  }
  const rawId = pathname.slice('/conversations/'.length, -suffix.length);
  if (!rawId || rawId.includes('/')) return null;
  return decodeURIComponent(rawId);
}

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

function defaultNotify(): JobDocument['notify'] {
  return {
    title: '',
    on: 'always',
    channel: { type: 'ntfy', topic: '' },
  };
}

function coerceCreateNotify(body: Record<string, unknown>): JobDocument['notify'] | null {
  if (body.notify === undefined) return null;
  if (!isObject(body.notify)) {
    throw new ConfigError('notify must be an object');
  }
  const notify = body.notify;
  const channelRaw = notify.channel;
  if (!isObject(channelRaw)) {
    throw new ConfigError('notify.channel must be an object');
  }
  const channelType = channelRaw.type;
  if (channelType === 'ntfy') {
    const topic = channelRaw.topic;
    if (typeof topic !== 'string') {
      throw new ConfigError('notify.channel.topic must be a string');
    }
    const channel: JobDocument['notify']['channel'] = { type: 'ntfy', topic };
    if (channelRaw.baseUrl !== undefined) {
      if (typeof channelRaw.baseUrl !== 'string') {
        throw new ConfigError('notify.channel.baseUrl must be a string');
      }
      channel.baseUrl = channelRaw.baseUrl;
      assertPublicHttpUrl(channel.baseUrl);
    }
    return {
      title: typeof notify.title === 'string' ? notify.title : '',
      on:
        notify.on === 'always' ||
        notify.on === 'change' ||
        notify.on === 'drop' ||
        notify.on === 'failure_only'
          ? notify.on
          : 'always',
      channel,
    };
  }
  if (channelType === 'webhook') {
    const url = channelRaw.url;
    if (typeof url !== 'string' || url.length === 0) {
      throw new ConfigError('notify.channel.url must be a non-empty string');
    }
    assertPublicHttpUrl(url);
    return {
      title: typeof notify.title === 'string' ? notify.title : '',
      on:
        notify.on === 'always' ||
        notify.on === 'change' ||
        notify.on === 'drop' ||
        notify.on === 'failure_only'
          ? notify.on
          : 'always',
      channel: { type: 'webhook', url },
    };
  }
  throw new ConfigError('notify.channel.type must be ntfy or webhook');
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

function redactConversationMessages(
  messages: ConversationMessage[],
  secrets: SecretDocument[],
  masterKey: Buffer,
): ConversationMessage[] {
  if (secrets.length === 0) return messages;
  const plaintextByKey = new Map<string, string>();
  for (const secret of secrets) {
    try {
      plaintextByKey.set(
        secret.key,
        decryptSecret(
          { ciphertext: secret.ciphertext, iv: secret.iv, tag: secret.tag },
          masterKey,
        ),
      );
    } catch {
      // Skip secrets that cannot be decrypted; do not leak ciphertext.
    }
  }
  return messages.map((message) => {
    let text = message.text;
    for (const [key, value] of plaintextByKey.entries()) {
      if (value.length > 0 && text.includes(value)) {
        text = text.split(value).join(`[secret:${key}]`);
      }
    }
    return text === message.text ? message : { ...message, text };
  });
}

function toConversationResponse(
  conversation: ConversationDocument,
  messages: ConversationMessage[],
): ConversationDocument {
  return { ...conversation, messages };
}

async function getOwnedConversation(
  store: BillingStore,
  conversationId: string,
  userId: string,
): Promise<ConversationDocument | null> {
  const conversation = await store.getConversation(conversationId);
  if (!conversation || conversation.userId !== userId) return null;
  return conversation;
}

async function handleCreateConversation(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
): Promise<void> {
  if (!ctx.onAuthorConversation) {
    sendJson(res, 503, { error: 'Authoring unavailable' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (!isObject(body)) {
    sendJson(res, 400, { error: 'request body must be an object' });
    return;
  }

  const startUrl = body.startUrl;
  const goal = body.goal;
  if (typeof startUrl !== 'string' || startUrl.length === 0) {
    sendJson(res, 400, { error: 'startUrl must be a non-empty string' });
    return;
  }
  if (typeof goal !== 'string' || goal.length === 0) {
    sendJson(res, 400, { error: 'goal must be a non-empty string' });
    return;
  }

  try {
    assertPublicHttpUrl(startUrl);
    const draftNotify = coerceCreateNotify(body);
    if (draftNotify?.channel.type === 'webhook') {
      assertPublicHttpUrl(draftNotify.channel.url);
    }
    if (draftNotify?.channel.type === 'ntfy' && draftNotify.channel.baseUrl) {
      assertPublicHttpUrl(draftNotify.channel.baseUrl);
    }
    const schedule =
      body.schedule === undefined || body.schedule === null
        ? null
        : typeof body.schedule === 'string'
          ? body.schedule
          : (() => {
              throw new ConfigError('schedule must be a string or null');
            })();

    const now = new Date().toISOString();
    const conversation: ConversationDocument = {
      id: randomUUID(),
      userId,
      status: 'active',
      jobId: null,
      startUrl,
      goal,
      messages: [],
      draftWorkflow: null,
      draftSchema: null,
      draftExtract: null,
      draftNotify,
      draftSchedule: schedule,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.store.upsertConversation(conversation);

    void ctx.onAuthorConversation(conversation.id).catch(() => {
      // Authoring failures are surfaced via conversation messages in slice 3.
    });

    sendJson(res, 201, conversation);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleGetConversation(
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await getOwnedConversation(ctx.store, conversationId, userId);
  if (!conversation) {
    sendJson(res, 404, { error: 'Conversation not found' });
    return;
  }

  const secrets = await ctx.store.listSecrets({ userId, conversationId });
  let messages = conversation.messages;
  if (secrets.length > 0) {
    try {
      const masterKey = parseMasterKey(ctx.env ?? process.env);
      messages = redactConversationMessages(conversation.messages, secrets, masterKey);
    } catch {
      // No master key: return messages unchanged; ciphertext never appears in messages.
    }
  }

  sendJson(res, 200, toConversationResponse(conversation, messages));
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await getOwnedConversation(ctx.store, conversationId, userId);
  if (!conversation) {
    sendJson(res, 404, { error: 'Conversation not found' });
    return;
  }
  if (conversation.status !== 'active') {
    sendJson(res, 409, { error: 'Conversation not active' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const text = isObject(body) && typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    sendJson(res, 400, { error: 'text must be a non-empty string' });
    return;
  }

  const now = new Date().toISOString();
  const message: ConversationMessage = {
    id: randomUUID(),
    role: 'user',
    text,
    createdAt: now,
  };
  const updated: ConversationDocument = {
    ...conversation,
    messages: [...conversation.messages, message],
    updatedAt: now,
  };
  await ctx.store.upsertConversation(updated);

  if (ctx.onAuthorConversation) {
    void ctx.onAuthorConversation(conversationId).catch(() => {});
  }

  sendJson(res, 200, updated);
}

async function handlePostSecrets(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await getOwnedConversation(ctx.store, conversationId, userId);
  if (!conversation) {
    sendJson(res, 404, { error: 'Conversation not found' });
    return;
  }
  if (conversation.status !== 'awaiting_secret') {
    sendJson(res, 409, { error: 'Conversation not awaiting secret' });
    return;
  }

  let values: Record<string, string>;
  try {
    values = parseSecretValues(await readJsonBody(req));
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }

  const entries = Object.entries(values);
  if (entries.length === 0) {
    sendJson(res, 400, { error: 'values must not be empty' });
    return;
  }

  const masterKey = parseMasterKey(ctx.env ?? process.env);
  const existing = await ctx.store.listSecrets({ userId, conversationId });
  const existingByKey = new Map(existing.map((secret) => [secret.key, secret]));
  const now = new Date().toISOString();

  for (const [key, value] of entries) {
    const previous = existingByKey.get(key);
    const secret: SecretDocument = {
      id: previous?.id ?? randomUUID(),
      userId,
      jobId: null,
      conversationId,
      key,
      ...encryptSecret(value, masterKey),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    await ctx.store.upsertSecret(secret);
  }

  const updated: ConversationDocument = {
    ...conversation,
    status: 'active',
    updatedAt: now,
  };
  await ctx.store.upsertConversation(updated);

  if (ctx.onAuthorConversation) {
    void ctx.onAuthorConversation(conversationId).catch(() => {});
  }

  sendJson(res, 200, updated);
}

async function handleConfirm(
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await getOwnedConversation(ctx.store, conversationId, userId);
  if (!conversation) {
    sendJson(res, 404, { error: 'Conversation not found' });
    return;
  }
  if (conversation.status !== 'confirming') {
    sendJson(res, 409, { error: 'Conversation not confirming' });
    return;
  }
  if (
    !conversation.startUrl ||
    !conversation.goal ||
    !conversation.draftWorkflow ||
    !conversation.draftSchema ||
    !conversation.draftNotify
  ) {
    sendJson(res, 409, { error: 'Conversation draft incomplete' });
    return;
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();
  const conversationSecrets = await ctx.store.listSecrets({ userId, conversationId });

  for (const secret of conversationSecrets) {
    await ctx.store.upsertSecret({
      ...secret,
      jobId,
      conversationId: null,
      updatedAt: now,
    });
  }

  const secretIds = conversationSecrets.map((secret) => secret.id);
  const jobName =
    conversation.draftNotify.title.trim().length > 0
      ? conversation.draftNotify.title
      : conversation.goal;

  const job = assertJobDocument({
    id: jobId,
    userId,
    name: jobName,
    enabled: true,
    schedule: conversation.draftSchedule,
    startUrl: conversation.startUrl,
    engine: 'workflow',
    goal: conversation.goal,
    schema: conversation.draftSchema,
    workflow: conversation.draftWorkflow,
    secretIds,
    notify: conversation.draftNotify,
    lastResult: conversation.draftExtract,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.store.upsertJob(job);
  await bumpJobsGeneration(ctx.store);

  const saved: ConversationDocument = {
    ...conversation,
    status: 'saved',
    jobId,
    updatedAt: now,
  };
  await ctx.store.upsertConversation(saved);

  ctx.lock?.release(conversationId);

  sendJson(res, 201, { jobId, conversationId });
}

async function handleAbandon(
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await getOwnedConversation(ctx.store, conversationId, userId);
  if (!conversation) {
    sendJson(res, 404, { error: 'Conversation not found' });
    return;
  }

  const now = new Date().toISOString();
  const updated: ConversationDocument = {
    ...conversation,
    status: 'abandoned',
    updatedAt: now,
  };
  await ctx.store.upsertConversation(updated);
  ctx.lock?.release(conversationId);

  sendJson(res, 200, updated);
}

async function handleReject(
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await getOwnedConversation(ctx.store, conversationId, userId);
  if (!conversation) {
    sendJson(res, 404, { error: 'Conversation not found' });
    return;
  }
  if (conversation.status !== 'confirming') {
    sendJson(res, 409, { error: 'Conversation not confirming' });
    return;
  }

  const now = new Date().toISOString();
  const updated: ConversationDocument = {
    ...conversation,
    status: 'active',
    updatedAt: now,
  };
  await ctx.store.upsertConversation(updated);

  if (ctx.onAuthorConversation) {
    void ctx.onAuthorConversation(conversationId).catch(() => {});
  }

  sendJson(res, 200, updated);
}

export async function handleConversationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
  pathname: string,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && pathname === '/conversations') {
    await handleCreateConversation(req, res, ctx, userId);
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/conversations/')) {
    const conversationId = decodeURIComponent(pathname.slice('/conversations/'.length));
    if (!conversationId || conversationId.includes('/')) {
      return false;
    }
    await handleGetConversation(res, ctx, userId, conversationId);
    return true;
  }

  const messageId = parseConversationSubresourceId(pathname, '/messages');
  if (messageId && method === 'POST') {
    await handlePostMessage(req, res, ctx, userId, messageId);
    return true;
  }

  const secretsId = parseConversationSubresourceId(pathname, '/secrets');
  if (secretsId && method === 'POST') {
    await handlePostSecrets(req, res, ctx, userId, secretsId);
    return true;
  }

  const confirmId = parseConversationSubresourceId(pathname, '/confirm');
  if (confirmId && method === 'POST') {
    await handleConfirm(res, ctx, userId, confirmId);
    return true;
  }

  const abandonId = parseConversationSubresourceId(pathname, '/abandon');
  if (abandonId && method === 'POST') {
    await handleAbandon(res, ctx, userId, abandonId);
    return true;
  }

  const rejectId = parseConversationSubresourceId(pathname, '/reject');
  if (rejectId && method === 'POST') {
    await handleReject(res, ctx, userId, rejectId);
    return true;
  }

  return false;
}
