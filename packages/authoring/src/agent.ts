import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mistral } from '@mistralai/mistralai';
import type { ContentChunk } from '@mistralai/mistralai/models/components/contentchunk.js';
import { chromium, type Page } from 'playwright';
import {
  decryptSecret,
  parseMasterKey,
  resolveMistralApiKey,
  validateWorkflow,
} from '@billing-agent/core';
import type {
  BillingStore,
  BrowserLock,
  ConversationDocument,
  ConversationMessage,
  ExtractField,
  SettingsDocument,
} from '@billing-agent/core';
import {
  closeAuthoringSession,
  getAuthoringSession,
  setAuthoringSession,
  type AuthoringSession,
} from './session.js';
import {
  authoringTools,
  isAuthoringToolName,
  MAX_TURNS_PER_CONVERSATION,
  MAX_TURNS_PER_MESSAGE,
  type AuthoringToolName,
} from './tools.js';

const BUSY_MESSAGE = 'Browser is busy with another session.';
const LIMIT_MESSAGE =
  'This session used too many automated steps. Please simplify your goal or abandon and start over.';

export type MistralToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type MistralCompletionResult = {
  content?: string;
  toolCalls?: MistralToolCall[];
};

type MistralChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: MistralToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export type AuthoringDeps = {
  launchSession: (input: {
    conversation: ConversationDocument;
    browser: SettingsDocument['browser'];
  }) => Promise<AuthoringSession>;
  completeWithTools: (input: {
    apiKey: string;
    model: string;
    messages: MistralChatMessage[];
  }) => Promise<MistralCompletionResult>;
};

function extractMessageContent(
  content: string | Array<ContentChunk> | null | undefined,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((chunk): chunk is ContentChunk & { text: string } => 'text' in chunk && typeof chunk.text === 'string')
    .map((chunk) => chunk.text)
    .join('');
}

function latestUserMessage(conversation: ConversationDocument): ConversationMessage | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === 'user') return message;
  }
  return null;
}

function secretPlaceholder(key: string): string {
  return `[secret:${key}]`;
}

async function appendMessage(
  store: BillingStore,
  conversation: ConversationDocument,
  message: Omit<ConversationMessage, 'id' | 'createdAt'>,
): Promise<ConversationDocument> {
  const now = new Date().toISOString();
  const updated: ConversationDocument = {
    ...conversation,
    messages: [
      ...conversation.messages,
      { ...message, id: randomUUID(), createdAt: now },
    ],
    updatedAt: now,
  };
  await store.upsertConversation(updated);
  return updated;
}

async function persistConversation(
  store: BillingStore,
  conversation: ConversationDocument,
): Promise<void> {
  await store.upsertConversation({
    ...conversation,
    updatedAt: new Date().toISOString(),
  });
}

function ownsLock(lock: BrowserLock, conversationId: string): boolean {
  const current = lock.current();
  return current?.kind === 'authoring' && current.id === conversationId;
}

function acquireAuthoringLock(lock: BrowserLock, conversationId: string): boolean {
  if (ownsLock(lock, conversationId)) return true;
  return lock.tryAcquire({ kind: 'authoring', id: conversationId });
}

async function defaultLaunchSession(input: {
  conversation: ConversationDocument;
  browser: SettingsDocument['browser'];
}): Promise<AuthoringSession> {
  const args = input.browser.noSandbox
    ? ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox']
    : ['--disable-dev-shm-usage', '--disable-gpu'];
  const browser = await chromium.launch({
    headless: input.browser.headless,
    args,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(input.browser.timeoutMs);
  if (input.conversation.startUrl) {
    await page.goto(input.conversation.startUrl, { waitUntil: 'domcontentloaded' });
  }
  return {
    browser,
    context,
    page,
    turnsThisMessage: 0,
    turnsTotal: 0,
    lastProcessedMessageId: null,
  };
}

async function defaultCompleteWithTools(input: {
  apiKey: string;
  model: string;
  messages: MistralChatMessage[];
}): Promise<MistralCompletionResult> {
  const mistral = new Mistral({ apiKey: input.apiKey });
  const response = await mistral.chat.complete({
    model: input.model,
    messages: input.messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool' as const,
          content: message.content,
          toolCallId: message.toolCallId,
          name: message.name,
        };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: message.content,
          toolCalls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function' as const,
            function: { name: toolCall.name, arguments: toolCall.arguments },
          })),
        };
      }
      return { role: message.role, content: message.content };
    }),
    tools: authoringTools,
    toolChoice: 'auto',
  });

  const choice = response.choices?.[0]?.message;
  return {
    content: extractMessageContent(choice?.content),
    toolCalls: choice?.toolCalls?.map((toolCall) => ({
      id: toolCall.id ?? randomUUID(),
      name: toolCall.function.name,
      arguments:
        typeof toolCall.function.arguments === 'string'
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function.arguments ?? {}),
    })),
  };
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

async function resolveSecretValue(
  store: BillingStore,
  conversation: ConversationDocument,
  secretKey: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const secrets = await store.listSecrets({
    userId: conversation.userId,
    conversationId: conversation.id,
  });
  const secret = secrets.find((entry) => entry.key === secretKey);
  if (!secret) {
    throw new Error(`Secret ${secretKey} is not set`);
  }
  const masterKey = parseMasterKey(env);
  return decryptSecret(
    { ciphertext: secret.ciphertext, iv: secret.iv, tag: secret.tag },
    masterKey,
  );
}

async function executeTool(
  toolName: AuthoringToolName,
  args: Record<string, unknown>,
  input: {
    page: Page;
    store: BillingStore;
    conversation: ConversationDocument;
    browser: SettingsDocument['browser'];
    env: NodeJS.ProcessEnv;
  },
): Promise<{ result: string; screenshotPath?: string }> {
  const { page, store, conversation, browser, env } = input;

  switch (toolName) {
    case 'snapshot': {
      const tree = await page.locator('body').ariaSnapshot();
      let screenshotPath: string | undefined;
      if (browser.saveErrorScreenshot) {
        const dir = join(tmpdir(), 'billing-agent-authoring');
        await mkdir(dir, { recursive: true });
        screenshotPath = join(dir, `${conversation.id}-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }
      return {
        result: JSON.stringify({ tree, screenshotPath: screenshotPath ?? null }),
        screenshotPath,
      };
    }
    case 'click': {
      const selector = String(args.selector ?? '');
      if (!selector) throw new Error('click.selector is required');
      await page.click(selector);
      return { result: JSON.stringify({ ok: true }) };
    }
    case 'fill': {
      const selector = String(args.selector ?? '');
      if (!selector) throw new Error('fill.selector is required');
      let value = typeof args.value === 'string' ? args.value : '';
      if (typeof args.secretKey === 'string' && args.secretKey.length > 0) {
        value = await resolveSecretValue(store, conversation, args.secretKey, env);
      }
      if (!value) throw new Error('fill requires value or secretKey');
      await page.fill(selector, value);
      return { result: JSON.stringify({ ok: true }) };
    }
    case 'wait': {
      const timeoutMs =
        typeof args.timeoutMs === 'number' && args.timeoutMs > 0
          ? args.timeoutMs
          : browser.timeoutMs;
      if (typeof args.selector === 'string' && args.selector.length > 0) {
        await page.waitForSelector(args.selector, { timeout: timeoutMs });
      } else {
        await page.waitForTimeout(Math.min(timeoutMs, 5000));
      }
      return { result: JSON.stringify({ ok: true }) };
    }
    case 'extract_candidates': {
      const fields = Array.isArray(args.fields) ? args.fields : [];
      const extracted: Record<string, string | number> = {};
      for (const field of fields) {
        if (typeof field !== 'object' || field === null) continue;
        const record = field as Record<string, unknown>;
        const key = typeof record.key === 'string' ? record.key : '';
        const selector = typeof record.selector === 'string' ? record.selector : '';
        if (!key || !selector) continue;
        const text = (await page.locator(selector).first().textContent())?.trim() ?? '';
        if (text.length > 0) extracted[key] = text;
      }
      return { result: JSON.stringify({ extract: extracted }) };
    }
    case 'ask_secret':
    case 'propose_job':
      return { result: JSON.stringify({ ok: true }) };
    default:
      throw new Error(`Unknown tool ${toolName satisfies never}`);
  }
}

function buildInitialMessages(conversation: ConversationDocument): MistralChatMessage[] {
  const lines = [
    'You are a web automation agent that builds replayable workflow jobs.',
    'Use the provided tools to navigate the page and achieve the user goal.',
    'Never ask the user to paste passwords into chat; use ask_secret instead.',
    'When you have a reliable workflow and sample extract, call propose_job.',
  ];
  const messages: MistralChatMessage[] = [
    { role: 'system', content: lines.join('\n') },
  ];

  if (conversation.messages.length === 0) {
    messages.push({
      role: 'user',
      content: `Start URL: ${conversation.startUrl}\nGoal: ${conversation.goal}`,
    });
    return messages;
  }

  for (const message of conversation.messages) {
    if (message.role === 'user' || message.role === 'assistant') {
      messages.push({ role: message.role, content: message.text });
    }
  }
  return messages;
}

function coerceExtractField(value: unknown, index: number): ExtractField {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`schema[${index}] must be an object`);
  }
  const record = value as Record<string, unknown>;
  const key = record.key;
  const label = record.label;
  const type = record.type;
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(`schema[${index}].key must be a non-empty string`);
  }
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error(`schema[${index}].label must be a non-empty string`);
  }
  if (type !== 'string' && type !== 'number' && type !== 'price' && type !== 'date') {
    throw new Error(`schema[${index}].type is invalid`);
  }
  return { key, label, type };
}

function coerceExtract(
  value: unknown,
): Record<string, string | number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('extract must be an object');
  }
  const result: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      result[key] = entry;
    }
  }
  return result;
}

export async function expireStaleAuthoringSessions(
  store: BillingStore,
): Promise<number> {
  const conversations = await store.listConversations({
    status: ['active', 'awaiting_secret', 'confirming'],
  });
  let expired = 0;
  for (const conversation of conversations) {
    if (getAuthoringSession(conversation.id)) continue;
    await store.upsertConversation({
      ...conversation,
      status: 'expired',
      updatedAt: new Date().toISOString(),
    });
    expired += 1;
  }
  return expired;
}

export async function handleAuthoringTurn(input: {
  store: BillingStore;
  conversationId: string;
  lock: BrowserLock;
  env: NodeJS.ProcessEnv;
  mistral: SettingsDocument['mistral'];
  browser: SettingsDocument['browser'];
  deps?: Partial<AuthoringDeps>;
}): Promise<void> {
  const deps: AuthoringDeps = {
    launchSession: defaultLaunchSession,
    completeWithTools: defaultCompleteWithTools,
    ...input.deps,
  };

  let conversation = await input.store.getConversation(input.conversationId);
  if (!conversation) return;
  if (conversation.status !== 'active') return;

  if (!acquireAuthoringLock(input.lock, input.conversationId)) {
    if (!ownsLock(input.lock, input.conversationId)) {
      await appendMessage(input.store, conversation, {
        role: 'assistant',
        text: BUSY_MESSAGE,
      });
    }
    return;
  }

  let session = getAuthoringSession(input.conversationId);
  if (!session) {
    session = await deps.launchSession({
      conversation,
      browser: input.browser,
    });
    setAuthoringSession(input.conversationId, session);
  }

  const userMessage = latestUserMessage(conversation);
  if (userMessage && userMessage.id !== session.lastProcessedMessageId) {
    session.turnsThisMessage = 0;
    session.lastProcessedMessageId = userMessage.id;
  }

  const chatMessages = buildInitialMessages(conversation);
  let apiKey: string | undefined;
  try {
    apiKey = resolveMistralApiKey(input.mistral, input.env);
  } catch {
    await appendMessage(input.store, conversation, {
      role: 'assistant',
      text: 'Authoring is unavailable because the Mistral API key is not configured.',
    });
    await closeAuthoringSession(input.conversationId);
    input.lock.release(input.conversationId);
    return;
  }

  while (
    session.turnsThisMessage < MAX_TURNS_PER_MESSAGE &&
    session.turnsTotal < MAX_TURNS_PER_CONVERSATION
  ) {
    const completion = await deps.completeWithTools({
      apiKey,
      model: input.mistral.model,
      messages: chatMessages,
    });

    if (!completion.toolCalls?.length) {
      const text = completion.content?.trim() || 'Done.';
      conversation = await appendMessage(input.store, conversation, {
        role: 'assistant',
        text,
      });
      break;
    }

    const assistantToolCalls = completion.toolCalls.filter((toolCall) =>
      isAuthoringToolName(toolCall.name),
    );
    if (assistantToolCalls.length === 0) {
      conversation = await appendMessage(input.store, conversation, {
        role: 'assistant',
        text: completion.content?.trim() || 'Unable to continue.',
      });
      break;
    }

    chatMessages.push({
      role: 'assistant',
      content: completion.content ?? '',
      toolCalls: assistantToolCalls,
    });

    for (const toolCall of assistantToolCalls) {
      session.turnsThisMessage += 1;
      session.turnsTotal += 1;

      const args = parseToolArgs(toolCall.arguments);
      const toolName = toolCall.name;

      if (toolName === 'ask_secret') {
        const keys = Array.isArray(args.keys)
          ? args.keys.filter((key): key is string => typeof key === 'string' && key.length > 0)
          : [];
        const preamble =
          typeof args.message === 'string' && args.message.trim().length > 0
            ? `${args.message.trim()}\n\n`
            : '';
        const placeholders = keys.map((key) => secretPlaceholder(key)).join(' ');
        conversation = await appendMessage(input.store, conversation, {
          role: 'assistant',
          text: `${preamble}${placeholders}`.trim(),
        });
        conversation = {
          ...conversation,
          status: 'awaiting_secret',
        };
        await persistConversation(input.store, conversation);
        return;
      }

      if (toolName === 'propose_job') {
        const workflow = validateWorkflow(args.workflow);
        const schemaRaw = Array.isArray(args.schema) ? args.schema : [];
        const schema = schemaRaw.map((field, index) => coerceExtractField(field, index));
        const extract = coerceExtract(args.extract);
        const message =
          typeof args.message === 'string' && args.message.trim().length > 0
            ? args.message.trim()
            : 'Please review the sample extract and confirm the job.';
        conversation = await appendMessage(input.store, conversation, {
          role: 'assistant',
          text: message,
        });
        conversation = {
          ...conversation,
          status: 'confirming',
          draftWorkflow: workflow,
          draftSchema: schema,
          draftExtract: extract,
        };
        await persistConversation(input.store, conversation);
        return;
      }

      let toolResult = '{"error":"tool failed"}';
      let screenshotPath: string | undefined;
      try {
        const executed = await executeTool(toolCall.name as AuthoringToolName, args, {
          page: session.page,
          store: input.store,
          conversation,
          browser: input.browser,
          env: input.env,
        });
        toolResult = executed.result;
        screenshotPath = executed.screenshotPath;
      } catch (error) {
        toolResult = JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
      }

      chatMessages.push({
        role: 'tool',
        content: toolResult,
        toolCallId: toolCall.id,
        name: toolCall.name,
      });

      if (screenshotPath) {
        conversation = await appendMessage(input.store, conversation, {
          role: 'assistant',
          text: 'Captured a page snapshot.',
          screenshotPath,
        });
      }

      if (
        session.turnsThisMessage >= MAX_TURNS_PER_MESSAGE ||
        session.turnsTotal >= MAX_TURNS_PER_CONVERSATION
      ) {
        break;
      }
    }

    if (
      session.turnsThisMessage >= MAX_TURNS_PER_MESSAGE ||
      session.turnsTotal >= MAX_TURNS_PER_CONVERSATION
    ) {
      conversation = await appendMessage(input.store, conversation, {
        role: 'assistant',
        text: LIMIT_MESSAGE,
      });
      break;
    }
  }
}

export { closeAuthoringSession, getAuthoringSession, listAuthoringSessionIds } from './session.js';
export { authoringTools, type AuthoringToolName } from './tools.js';
