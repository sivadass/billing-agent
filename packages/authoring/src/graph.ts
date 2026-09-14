import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
  isGraphInterrupt,
} from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type {
  BillingStore,
  BrowserLock,
  ConversationDocument,
  ExtractField,
  SettingsDocument,
} from '@billing-agent/core';
import {
  createLogger,
  resolveMistralApiKey,
  validateWorkflow,
} from '@billing-agent/core';
import type { ConversationStreamEvent } from './events.js';
import {
  isAuthoringToolName,
  isPlaywrightToolName,
  MAX_TURNS_PER_CONVERSATION,
  MAX_TURNS_PER_MESSAGE,
  type AuthoringToolName,
} from './tools.js';
import { trimLlmMessages, type LlmMessage } from './trim.js';
import {
  closeAuthoringSession,
  getAuthoringSession,
  setAuthoringSession,
  type AuthoringSession,
} from './session.js';
import type { AuthoringDeps, MistralCompletionResult, MistralToolCall } from './agent.js';

const BUSY_MESSAGE = 'Browser is busy with another session.';
const LIMIT_MESSAGE =
  'This session used too many automated steps. Please simplify your goal or abandon and start over.';

export type AuthoringResumeValue =
  | { secretsSubmitted: string[] }
  | { keepGoing: true };

export type AuthoringGraphContext = {
  store: BillingStore;
  lock: BrowserLock;
  env: NodeJS.ProcessEnv;
  mistral: SettingsDocument['mistral'];
  browser: SettingsDocument['browser'];
  deps: AuthoringDeps;
  publish: (conversationId: string, event: ConversationStreamEvent) => void;
  executeTool: typeof import('./agent.js').executeTool;
  launchSession: AuthoringDeps['launchSession'];
  hasCheckpoint: (conversationId: string) => Promise<boolean>;
  conversationId: string;
  signal?: AbortSignal;
};

const AuthoringState = Annotation.Root({
  llm_messages: Annotation<LlmMessage[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  turns_this_message: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  turns_total: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  last_page_url: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  done: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false,
  }),
  pending_completion: Annotation<MistralCompletionResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

type GraphState = typeof AuthoringState.State;

function systemPrompt(): string {
  return [
    'You are a web automation agent that builds replayable workflow jobs.',
    'Use the provided tools to navigate the page and achieve the user goal.',
    'Never ask the user to paste passwords into chat; use ask_secret instead.',
    'When you have a reliable workflow and sample extract, call propose_job.',
  ].join('\n');
}

function latestUserMessage(conversation: ConversationDocument) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message?.role === 'user') return message;
  }
  return null;
}

function secretPlaceholder(key: string): string {
  return `[secret:${key}]`;
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

function coerceExtract(value: unknown): Record<string, string | number> {
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

function ownsLock(lock: BrowserLock, conversationId: string): boolean {
  const current = lock.current();
  return current?.kind === 'authoring' && current.id === conversationId;
}

function acquireAuthoringLock(lock: BrowserLock, conversationId: string): boolean {
  if (ownsLock(lock, conversationId)) return true;
  return lock.tryAcquire({ kind: 'authoring', id: conversationId });
}

async function appendAssistantMessage(
  ctx: AuthoringGraphContext,
  text: string,
  screenshotPath?: string,
): Promise<ConversationDocument | null> {
  const message = {
    id: randomUUID(),
    role: 'assistant' as const,
    text,
    createdAt: new Date().toISOString(),
    ...(screenshotPath ? { screenshotPath } : {}),
  };
  return ctx.store.appendConversationMessage(ctx.conversationId, message);
}

export function createAuthoringGraph(ctx: AuthoringGraphContext) {
  async function ensureBrowserNode(state: GraphState): Promise<Partial<GraphState>> {
    if (ctx.signal?.aborted || state.done) return { done: true };

    const conversation = await ctx.store.getConversation(ctx.conversationId);
    if (!conversation || conversation.status !== 'active') {
      return { done: true };
    }

    if (!acquireAuthoringLock(ctx.lock, ctx.conversationId)) {
      if (!ownsLock(ctx.lock, ctx.conversationId)) {
        await appendAssistantMessage(ctx, BUSY_MESSAGE);
      }
      return { done: true };
    }

    let session = getAuthoringSession(ctx.conversationId);
    if (!session) {
      session = await ctx.launchSession({ conversation, browser: ctx.browser });
      setAuthoringSession(ctx.conversationId, session);
      const url = state.last_page_url ?? conversation.startUrl;
      if (url) {
        await session.page.goto(url, { waitUntil: 'domcontentloaded' });
      }
    }

    try {
      resolveMistralApiKey(ctx.mistral, ctx.env);
    } catch {
      await appendAssistantMessage(
        ctx,
        'Authoring is unavailable because the Mistral API key is not configured.',
      );
      await closeAuthoringSession(ctx.conversationId);
      ctx.lock.release(ctx.conversationId);
      return { done: true };
    }

    return {};
  }

  async function initMessagesNode(state: GraphState): Promise<Partial<GraphState>> {
    if (ctx.signal?.aborted || state.done) return { done: true };

    const conversation = await ctx.store.getConversation(ctx.conversationId);
    if (!conversation || conversation.status !== 'active') {
      return { done: true };
    }

    const hadCheckpoint = await ctx.hasCheckpoint(ctx.conversationId);
    let llmMessages = [...state.llm_messages];
    let turnsThisMessage = state.turns_this_message;

    if (llmMessages.length === 0) {
      llmMessages = [
        { role: 'system', content: systemPrompt() },
        {
          role: 'user',
          content: `Start URL: ${conversation.startUrl}\nGoal: ${conversation.goal}`,
        },
      ];
      turnsThisMessage = 0;
    } else if (hadCheckpoint) {
      const userMessage = latestUserMessage(conversation);
      const session = getAuthoringSession(ctx.conversationId);
      if (
        userMessage &&
        session &&
        userMessage.id !== session.lastProcessedMessageId
      ) {
        llmMessages.push({ role: 'user', content: userMessage.text });
        turnsThisMessage = 0;
        session.lastProcessedMessageId = userMessage.id;
      }
    }

    return {
      llm_messages: llmMessages,
      turns_this_message: turnsThisMessage,
    };
  }

  async function modelNode(state: GraphState): Promise<Partial<GraphState>> {
    if (ctx.signal?.aborted || state.done) return { done: true };

    if (
      state.turns_this_message >= MAX_TURNS_PER_MESSAGE ||
      state.turns_total >= MAX_TURNS_PER_CONVERSATION
    ) {
      await appendAssistantMessage(ctx, LIMIT_MESSAGE);
      ctx.publish(ctx.conversationId, {
        type: 'turn_end',
        conversationId: ctx.conversationId,
        at: new Date().toISOString(),
      });
      return { done: true };
    }

    const apiKey = resolveMistralApiKey(ctx.mistral, ctx.env);
    const completion = await ctx.deps.completeWithTools({
      apiKey,
      model: ctx.mistral.model,
      messages: state.llm_messages,
    });

    return { pending_completion: completion };
  }

  async function replyNode(state: GraphState): Promise<Partial<GraphState>> {
    const completion = state.pending_completion;
    const hasUnknownTools =
      (completion?.toolCalls?.length ?? 0) > 0 &&
      !completion?.toolCalls?.some((toolCall) => isAuthoringToolName(toolCall.name));
    const text = hasUnknownTools
      ? completion?.content?.trim() || 'Unable to continue.'
      : completion?.content?.trim() || 'Done.';
    await appendAssistantMessage(ctx, text);
    ctx.publish(ctx.conversationId, {
      type: 'turn_end',
      conversationId: ctx.conversationId,
      at: new Date().toISOString(),
    });
    return { done: true, pending_completion: null };
  }

  async function handleHitlTool(toolCall: MistralToolCall): Promise<Partial<GraphState>> {
    const args = parseToolArgs(toolCall.arguments);

    if (toolCall.name === 'ask_secret') {
      const conversation = await ctx.store.getConversation(ctx.conversationId);
      const alreadyAsked = conversation?.messages.some(
        (message) => message.role === 'assistant' && message.text.includes('[secret:'),
      );
      if (!alreadyAsked) {
        const keys = Array.isArray(args.keys)
          ? args.keys.filter((key): key is string => typeof key === 'string' && key.length > 0)
          : [];
        const preamble =
          typeof args.message === 'string' && args.message.trim().length > 0
            ? `${args.message.trim()}\n\n`
            : '';
        const placeholders = keys.map((key) => secretPlaceholder(key)).join(' ');
        await appendAssistantMessage(ctx, `${preamble}${placeholders}`.trim());
        await ctx.store.patchConversation(ctx.conversationId, { status: 'awaiting_secret' });
        ctx.publish(ctx.conversationId, {
          type: 'interrupt',
          kind: 'secret',
          conversationId: ctx.conversationId,
          at: new Date().toISOString(),
        });
      }

      interrupt('ask_secret');
      return { pending_completion: null };
    }

    if (toolCall.name === 'propose_job') {
      const workflow = validateWorkflow(args.workflow);
      const schemaRaw = Array.isArray(args.schema) ? args.schema : [];
      const schema = schemaRaw.map((field, index) => coerceExtractField(field, index));
      const extract = coerceExtract(args.extract);
      const message =
        typeof args.message === 'string' && args.message.trim().length > 0
          ? args.message.trim()
          : 'Please review the sample extract and confirm the job.';
      await appendAssistantMessage(ctx, message);
      await ctx.store.patchConversation(ctx.conversationId, {
        status: 'confirming',
        draftWorkflow: workflow,
        draftSchema: schema,
        draftExtract: extract,
      });
      ctx.publish(ctx.conversationId, {
        type: 'interrupt',
        kind: 'confirm',
        conversationId: ctx.conversationId,
        at: new Date().toISOString(),
      });
      interrupt('propose_job');
      return { done: true };
    }

    return { done: true };
  }

  async function actNode(state: GraphState): Promise<Partial<GraphState>> {
    if (ctx.signal?.aborted || state.done) return { done: true };

    const completion = state.pending_completion;
    const assistantToolCalls =
      completion?.toolCalls?.filter((toolCall) => isAuthoringToolName(toolCall.name)) ?? [];
    if (assistantToolCalls.length === 0) {
      return { done: true };
    }

    const session = getAuthoringSession(ctx.conversationId);
    const conversation = await ctx.store.getConversation(ctx.conversationId);
    if (!session || !conversation) return { done: true };

    let llmMessages = [...state.llm_messages];
    let turnsThisMessage = state.turns_this_message;
    let turnsTotal = state.turns_total;
    let lastPageUrl = state.last_page_url;

    llmMessages.push({
      role: 'assistant',
      content: completion?.content ?? '',
      toolCalls: assistantToolCalls,
    });

    for (const toolCall of assistantToolCalls) {
      if (ctx.signal?.aborted) return { done: true };

      const toolName = toolCall.name as AuthoringToolName;
      if (toolName === 'ask_secret' || toolName === 'propose_job') {
        return handleHitlTool(toolCall);
      }

      turnsThisMessage += 1;
      turnsTotal += 1;

      if (isPlaywrightToolName(toolName)) {
        ctx.publish(ctx.conversationId, {
          type: 'tool',
          tool: toolName,
          conversationId: ctx.conversationId,
          at: new Date().toISOString(),
        });
      }

      const args = parseToolArgs(toolCall.arguments);
      let toolResult = '{"error":"tool failed"}';
      let screenshotPath: string | undefined;
      try {
        const executed = await ctx.executeTool(toolName, args, {
          page: session.page,
          store: ctx.store,
          conversation,
          browser: ctx.browser,
          env: ctx.env,
          uploadScreenshot: ctx.deps.uploadScreenshot,
        });
        toolResult = executed.result;
        screenshotPath = executed.screenshotPath;
      } catch (error) {
        toolResult = JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
      }

      llmMessages.push({
        role: 'tool',
        content: toolResult,
        toolCallId: toolCall.id,
        name: toolCall.name,
      });

      llmMessages = trimLlmMessages(llmMessages);

      if (screenshotPath) {
        await appendAssistantMessage(ctx, 'Captured a page snapshot.', screenshotPath);
      }

      try {
        lastPageUrl = session.page.url();
      } catch {
        createLogger(ctx.conversationId).warn('unable to read page url after tool');
      }

      if (
        turnsThisMessage >= MAX_TURNS_PER_MESSAGE ||
        turnsTotal >= MAX_TURNS_PER_CONVERSATION
      ) {
        await appendAssistantMessage(ctx, LIMIT_MESSAGE);
        ctx.publish(ctx.conversationId, {
        type: 'turn_end',
        conversationId: ctx.conversationId,
        at: new Date().toISOString(),
      });
        return {
          llm_messages: llmMessages,
          turns_this_message: turnsThisMessage,
          turns_total: turnsTotal,
          last_page_url: lastPageUrl,
          done: true,
          pending_completion: null,
        };
      }
    }

    return {
      llm_messages: llmMessages,
      turns_this_message: turnsThisMessage,
      turns_total: turnsTotal,
      last_page_url: lastPageUrl,
      pending_completion: null,
    };
  }

  function routeAfterModel(state: GraphState): string {
    if (state.done) return END;
    const completion = state.pending_completion;
    if (!completion?.toolCalls?.length) return 'reply';
    const assistantToolCalls =
      completion.toolCalls.filter((toolCall) => isAuthoringToolName(toolCall.name));
    if (assistantToolCalls.length === 0) return 'reply';
    return 'act';
  }

  function routeAfterAct(state: GraphState): string {
    if (state.done) return END;
    if (
      state.turns_this_message >= MAX_TURNS_PER_MESSAGE ||
      state.turns_total >= MAX_TURNS_PER_CONVERSATION
    ) {
      return END;
    }
    return 'model';
  }

  const graph = new StateGraph(AuthoringState)
    .addNode('ensure_browser', ensureBrowserNode)
    .addNode('init_messages', initMessagesNode)
    .addNode('model', modelNode)
    .addNode('reply', replyNode)
    .addNode('act', actNode)
    .addEdge(START, 'ensure_browser')
    .addConditionalEdges('ensure_browser', (state) => (state.done ? END : 'init_messages'))
    .addConditionalEdges('init_messages', (state) => (state.done ? END : 'model'))
    .addConditionalEdges('model', routeAfterModel)
    .addEdge('reply', END)
    .addConditionalEdges('act', routeAfterAct);

  return graph;
}

export function compileAuthoringGraph(
  ctx: AuthoringGraphContext,
  checkpointer: BaseCheckpointSaver,
) {
  return createAuthoringGraph(ctx).compile({ checkpointer });
}

export async function invokeAuthoringGraph(
  compiled: ReturnType<typeof compileAuthoringGraph>,
  input: Parameters<ReturnType<typeof compileAuthoringGraph>['invoke']>[0],
  conversationId: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await compiled.invoke(input, {
      configurable: { thread_id: conversationId },
      signal,
    });
  } catch (error) {
    if (isGraphInterrupt(error)) return;
    throw error;
  }
}

export type { Page };
