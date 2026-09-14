import { ApiClientError, apiFetch } from './api-client';
import { isInProgressConversationStatus } from './conversation-status';

export type ConversationToolName =
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'wait'
  | 'extract_candidates';

export type ConversationStreamEvent =
  | { type: 'tool'; tool: ConversationToolName; conversationId: string; at: string }
  | { type: 'interrupt'; kind: 'secret' | 'confirm'; conversationId: string; at: string }
  | { type: 'turn_end'; conversationId: string; at: string };
import type {
  ConversationDocument,
  ConversationStatus,
  ConversationSummary,
  CreateConversationInput,
  ConfirmConversationResponse,
} from './types';

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function throwForNonOk(response: Response): Promise<void> {
  if (response.ok) return;
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body.error === 'string' && body.error.trim()) {
      message = body.error;
    } else if (typeof body.message === 'string' && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // keep default fallback message
  }
  throw new ApiClientError(message, 'http', response.status);
}

export function isPollingConversationStatus(status: ConversationStatus): boolean {
  return isInProgressConversationStatus(status);
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const response = await apiFetch('/conversations');
  await throwForNonOk(response);
  return parseJson<ConversationSummary[]>(response);
}

export async function createConversation(
  input: CreateConversationInput,
): Promise<ConversationDocument> {
  const response = await apiFetch('/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  await throwForNonOk(response);
  return parseJson<ConversationDocument>(response);
}

export async function getConversation(id: string): Promise<ConversationDocument> {
  const response = await apiFetch(`/conversations/${encodeURIComponent(id)}`);
  await throwForNonOk(response);
  return parseJson<ConversationDocument>(response);
}

export async function postConversationMessage(
  id: string,
  text: string,
): Promise<ConversationDocument> {
  const response = await apiFetch(`/conversations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  await throwForNonOk(response);
  return parseJson<ConversationDocument>(response);
}

export async function postConversationSecrets(
  id: string,
  values: Record<string, string>,
): Promise<ConversationDocument> {
  const response = await apiFetch(`/conversations/${encodeURIComponent(id)}/secrets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  await throwForNonOk(response);
  return parseJson<ConversationDocument>(response);
}

export async function confirmConversation(id: string): Promise<ConfirmConversationResponse> {
  const response = await apiFetch(`/conversations/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
  });
  await throwForNonOk(response);
  return parseJson<ConfirmConversationResponse>(response);
}

/** Leave confirming and continue refining the workflow in chat. */
export async function rejectConversationDraft(id: string): Promise<ConversationDocument> {
  const response = await apiFetch(`/conversations/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
  });
  await throwForNonOk(response);
  return parseJson<ConversationDocument>(response);
}

export async function abandonConversation(id: string): Promise<ConversationDocument> {
  const response = await apiFetch(`/conversations/${encodeURIComponent(id)}/abandon`, {
    method: 'POST',
  });
  await throwForNonOk(response);
  return parseJson<ConversationDocument>(response);
}

function parseSseBlock(
  block: string,
): { event?: string; data?: string } {
  let event: string | undefined;
  let data: string | undefined;
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data = line.slice('data:'.length).trim();
    }
  }
  return { event, data };
}

export async function subscribeConversationEvents(
  conversationId: string,
  onEvent: (event: ConversationStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await apiFetch(`/conversations/${encodeURIComponent(conversationId)}/events`, {
    signal,
  });
  if (!response.ok || !response.body) {
    throw new ApiClientError(
      `Request failed (${response.status})`,
      'http',
      response.status,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      if (!block.trim() || block.trim().startsWith(':')) continue;
      const parsed = parseSseBlock(block);
      if (!parsed.event || !parsed.data) continue;
      if (
        parsed.event !== 'tool' &&
        parsed.event !== 'interrupt' &&
        parsed.event !== 'turn_end'
      ) {
        continue;
      }
      onEvent(JSON.parse(parsed.data) as ConversationStreamEvent);
    }
  }
}

export function parseSecretKeysFromMessages(
  messages: ConversationDocument['messages'],
): string[] {
  const keys = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const match of message.text.matchAll(/\[secret:([^\]]+)\]/g)) {
      const key = match[1]?.trim();
      if (key) keys.add(key);
    }
  }
  return [...keys];
}
