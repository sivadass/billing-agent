import { ApiClientError, apiFetch } from './api-client';
import type { RunDocument } from './types';

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
    // keep fallback
  }
  throw new ApiClientError(message, 'http', response.status);
}

export async function listRuns(options?: { jobId?: string; limit?: number }): Promise<RunDocument[]> {
  const params = new URLSearchParams();
  if (options?.jobId) {
    params.set('jobId', options.jobId);
  }
  if (typeof options?.limit === 'number') {
    params.set('limit', String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/runs?${query}` : '/runs';
  const response = await apiFetch(path);
  await throwForNonOk(response);
  return parseJson<RunDocument[]>(response);
}

export async function getRun(id: string): Promise<RunDocument> {
  const response = await apiFetch(`/runs/${encodeURIComponent(id)}`);
  await throwForNonOk(response);
  return parseJson<RunDocument>(response);
}
