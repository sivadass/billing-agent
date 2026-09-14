import { Command, MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { BillingStore, BrowserLock, SettingsDocument } from '@billing-agent/core';
import {
  defaultCompleteWithTools,
  defaultLaunchSession,
  defaultUploadScreenshot,
  executeTool,
  type AuthoringDeps,
} from './agent.js';
import { createConversationEventBus } from './events.js';
import { compileAuthoringGraph, invokeAuthoringGraph, type AuthoringResumeValue } from './graph.js';
import { createAuthoringRunMap } from './runs.js';
import { closeAuthoringSession } from './session.js';

export type AuthoringCheckpointPort = {
  has(conversationId: string): Promise<boolean>;
  delete(conversationId: string): Promise<void>;
};

export type AuthoringRuntime = {
  events: ReturnType<typeof createConversationEventBus>;
  isRunning(conversationId: string): boolean;
  invoke(conversationId: string): Promise<void>;
  resume(conversationId: string, value: AuthoringResumeValue): Promise<void>;
  cancel(conversationId: string): Promise<void>;
  hasCheckpoint(conversationId: string): Promise<boolean>;
  deleteCheckpoint(conversationId: string): Promise<void>;
};

export function createAuthoringRuntime(input: {
  store: BillingStore;
  lock: BrowserLock;
  env: NodeJS.ProcessEnv;
  mistral: SettingsDocument['mistral'] | (() => SettingsDocument['mistral']);
  browser: SettingsDocument['browser'] | (() => SettingsDocument['browser']);
  checkpointer: BaseCheckpointSaver;
  checkpoints: AuthoringCheckpointPort;
  deps?: Partial<AuthoringDeps>;
  events?: ReturnType<typeof createConversationEventBus>;
  runs?: ReturnType<typeof createAuthoringRunMap>;
}): AuthoringRuntime {
  const events = input.events ?? createConversationEventBus();
  const runs = input.runs ?? createAuthoringRunMap();
  const deps: AuthoringDeps = {
    launchSession: defaultLaunchSession,
    completeWithTools: defaultCompleteWithTools,
    uploadScreenshot: defaultUploadScreenshot,
    ...input.deps,
  };

  const getSettings = () => ({
    mistral: typeof input.mistral === 'function' ? input.mistral() : input.mistral,
    browser: typeof input.browser === 'function' ? input.browser() : input.browser,
  });

  function buildCompiled(conversationId: string, signal?: AbortSignal) {
    const settings = getSettings();
    const ctx = {
      store: input.store,
      lock: input.lock,
      env: input.env,
      mistral: settings.mistral,
      browser: settings.browser,
      deps,
      publish: events.publish.bind(events),
      executeTool,
      launchSession: deps.launchSession,
      hasCheckpoint: input.checkpoints.has.bind(input.checkpoints),
      conversationId,
      signal,
    };
    return compileAuthoringGraph(ctx, input.checkpointer);
  }

  async function runGraph(
    conversationId: string,
    command: Parameters<ReturnType<typeof compileAuthoringGraph>['invoke']>[0],
  ): Promise<void> {
    const signal = runs.begin(conversationId);
    try {
      const compiled = buildCompiled(conversationId, signal);
      await invokeAuthoringGraph(compiled, command, conversationId, signal);
    } finally {
      runs.end(conversationId);
    }
  }

  return {
    events,
    isRunning(conversationId) {
      return runs.isRunning(conversationId);
    },
    async invoke(conversationId) {
      await runGraph(conversationId, {});
    },
    async resume(conversationId, value) {
      await runGraph(conversationId, new Command({ resume: value }));
    },
    async cancel(conversationId) {
      runs.abort(conversationId);
      await closeAuthoringSession(conversationId);
      input.lock.release(conversationId);
      await input.checkpoints.delete(conversationId);
    },
    hasCheckpoint(conversationId) {
      return input.checkpoints.has(conversationId);
    },
    deleteCheckpoint(conversationId) {
      return input.checkpoints.delete(conversationId);
    },
  };
}

export function createInMemoryCheckpointPort(): AuthoringCheckpointPort & {
  ids: Set<string>;
} {
  const ids = new Set<string>();
  return {
    ids,
    async has(id) {
      return ids.has(id);
    },
    async delete(id) {
      ids.delete(id);
    },
  };
}

export async function expireStaleAuthoringSessions(
  store: BillingStore,
  checkpoints: AuthoringCheckpointPort,
): Promise<number> {
  let expired = 0;

  const inProgress = await store.listConversations({
    status: ['active', 'awaiting_secret', 'confirming'],
  });
  for (const conversation of inProgress) {
    if (await checkpoints.has(conversation.id)) continue;
    await store.patchConversation(conversation.id, { status: 'expired' });
    expired += 1;
  }

  const terminal = await store.listConversations({
    status: ['saved', 'abandoned', 'expired'],
  });
  for (const conversation of terminal) {
    await checkpoints.delete(conversation.id);
  }

  return expired;
}

export function createEphemeralAuthoringRuntime(input: {
  store: BillingStore;
  lock: BrowserLock;
  env: NodeJS.ProcessEnv;
  mistral: SettingsDocument['mistral'];
  browser: SettingsDocument['browser'];
  deps?: Partial<AuthoringDeps>;
}): AuthoringRuntime {
  const checkpoints = createInMemoryCheckpointPort();
  const checkpointer = new MemorySaver();
  const originalHas = checkpoints.has.bind(checkpoints);
  checkpoints.has = async (id) => {
    if (await originalHas(id)) return true;
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: id } });
    return tuple !== undefined && tuple !== null;
  };
  checkpoints.delete = async (id) => {
    checkpoints.ids.delete(id);
    await checkpointer.deleteThread(id);
  };

  const runtime = createAuthoringRuntime({
    ...input,
    checkpointer,
    checkpoints,
  });

  const wrappedInvoke = runtime.invoke.bind(runtime);
  runtime.invoke = async (conversationId) => {
    await wrappedInvoke(conversationId);
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: conversationId } });
    if (tuple) checkpoints.ids.add(conversationId);
  };

  const wrappedResume = runtime.resume.bind(runtime);
  runtime.resume = async (conversationId, value) => {
    await wrappedResume(conversationId, value);
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: conversationId } });
    if (tuple) checkpoints.ids.add(conversationId);
  };

  return runtime;
}
