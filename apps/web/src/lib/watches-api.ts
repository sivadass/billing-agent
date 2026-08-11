import { ApiClientError, apiFetch } from './api-client';
import type { PriceCheckDocument, WatchDocument } from './types';

type RunWatchNowResponse = {
  id: string;
};

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

export async function listWatches(): Promise<WatchDocument[]> {
  const response = await apiFetch('/watches');
  await throwForNonOk(response);
  return parseJson<WatchDocument[]>(response);
}

export async function getWatch(id: string): Promise<WatchDocument> {
  const response = await apiFetch(`/watches/${encodeURIComponent(id)}`);
  await throwForNonOk(response);
  return parseJson<WatchDocument>(response);
}

export async function createWatch(watch: WatchDocument): Promise<WatchDocument> {
  const response = await apiFetch('/watches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(watch),
  });
  await throwForNonOk(response);
  return parseJson<WatchDocument>(response);
}

export async function updateWatch(id: string, patch: Partial<WatchDocument>): Promise<WatchDocument> {
  const response = await apiFetch(`/watches/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await throwForNonOk(response);
  return parseJson<WatchDocument>(response);
}

export async function deleteWatch(id: string): Promise<void> {
  const response = await apiFetch(`/watches/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await throwForNonOk(response);
}

export async function runWatchNow(id: string): Promise<RunWatchNowResponse> {
  const response = await apiFetch(`/watches/${encodeURIComponent(id)}/check`, {
    method: 'POST',
  });
  await throwForNonOk(response);
  return parseJson<RunWatchNowResponse>(response);
}

export async function listWatchChecks(
  watchId: string,
  options?: { limit?: number },
): Promise<PriceCheckDocument[]> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await apiFetch(`/watches/${encodeURIComponent(watchId)}/checks${suffix}`);
  await throwForNonOk(response);
  return parseJson<PriceCheckDocument[]>(response);
}
