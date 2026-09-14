import { randomUUID } from 'node:crypto';
import { Mistral } from '@mistralai/mistralai';
import type { ContentChunk } from '@mistralai/mistralai/models/components/contentchunk.js';
import { chromium, type Page } from 'playwright';
import {
  createLogger,
  decryptSecret,
  isObjectStorageConfigured,
  parseMasterKey,
  uploadConversationScreenshot,
} from '@billing-agent/core';
import type {
  BillingStore,
  BrowserLock,
  ConversationDocument,
  SettingsDocument,
} from '@billing-agent/core';
import type { AuthoringSession } from './session.js';
import { authoringTools, type AuthoringToolName } from './tools.js';
import type { LlmMessage } from './trim.js';
import type { AuthoringRuntime } from './runtime.js';
import { createEphemeralAuthoringRuntime } from './runtime.js';

export type MistralToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type MistralCompletionResult = {
  content?: string;
  toolCalls?: MistralToolCall[];
};

export type AuthoringDeps = {
  launchSession: (input: {
    conversation: ConversationDocument;
    browser: SettingsDocument['browser'];
  }) => Promise<AuthoringSession>;
  completeWithTools: (input: {
    apiKey: string;
    model: string;
    messages: LlmMessage[];
  }) => Promise<MistralCompletionResult>;
  uploadScreenshot: (input: {
    conversationId: string;
    body: Buffer;
    env: NodeJS.ProcessEnv;
  }) => Promise<string | undefined>;
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

export async function defaultUploadScreenshot(input: {
  conversationId: string;
  body: Buffer;
  env: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  if (!isObjectStorageConfigured(input.env)) return undefined;
  return uploadConversationScreenshot(input);
}

export async function defaultLaunchSession(input: {
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
    lastProcessedMessageId: null,
  };
}

export async function defaultCompleteWithTools(input: {
  apiKey: string;
  model: string;
  messages: LlmMessage[];
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

export async function executeTool(
  toolName: AuthoringToolName,
  args: Record<string, unknown>,
  input: {
    page: Page;
    store: BillingStore;
    conversation: ConversationDocument;
    browser: SettingsDocument['browser'];
    env: NodeJS.ProcessEnv;
    uploadScreenshot: AuthoringDeps['uploadScreenshot'];
  },
): Promise<{ result: string; screenshotPath?: string }> {
  const { page, store, conversation, browser, env } = input;

  switch (toolName) {
    case 'snapshot': {
      const tree = await page.locator('body').ariaSnapshot();
      let screenshotPath: string | undefined;
      try {
        const raw = await page.screenshot({ type: 'png', fullPage: true });
        const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        screenshotPath = await input.uploadScreenshot({
          conversationId: conversation.id,
          body,
          env,
        });
      } catch (error) {
        createLogger(conversation.id).warn('conversation screenshot upload failed', {
          error: error instanceof Error ? error.message : String(error),
        });
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

export async function handleAuthoringTurn(
  input: {
    store: BillingStore;
    conversationId: string;
    lock: BrowserLock;
    env: NodeJS.ProcessEnv;
    mistral: SettingsDocument['mistral'];
    browser: SettingsDocument['browser'];
    deps?: Partial<AuthoringDeps>;
  },
  runtime?: AuthoringRuntime,
): Promise<void> {
  const activeRuntime =
    runtime ??
    createEphemeralAuthoringRuntime({
      store: input.store,
      lock: input.lock,
      env: input.env,
      mistral: input.mistral,
      browser: input.browser,
      deps: input.deps,
    });
  await activeRuntime.invoke(input.conversationId);
}

export { closeAuthoringSession, getAuthoringSession, listAuthoringSessionIds } from './session.js';
export { authoringTools, type AuthoringToolName } from './tools.js';
