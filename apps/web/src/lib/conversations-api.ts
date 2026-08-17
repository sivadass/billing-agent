import { ApiClientError, apiFetch } from './api-client';
import type {
  ConversationDocument,
  ConversationStatus,
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
  return status === 'active' || status === 'awaiting_secret' || status === 'confirming';
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
