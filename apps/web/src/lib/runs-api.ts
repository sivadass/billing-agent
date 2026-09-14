import { ApiClientError, apiFetch } from './api-client';
import type { RunDocument } from './types';

export type ListRunsResult = {
  runs: RunDocument[];
  total: number;
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
    // keep fallback
  }
  throw new ApiClientError(message, 'http', response.status);
}

function normalizeListRunsPayload(body: unknown): ListRunsResult {
  if (Array.isArray(body)) {
    return { runs: body as RunDocument[], total: body.length };
  }
  if (body && typeof body === 'object') {
    const payload = body as { runs?: unknown; total?: unknown };
    const runs = Array.isArray(payload.runs) ? (payload.runs as RunDocument[]) : [];
    const total =
      typeof payload.total === 'number' && Number.isFinite(payload.total)
        ? payload.total
        : runs.length;
    return { runs, total };
  }
  return { runs: [], total: 0 };
}

export async function listRuns(options?: {
  jobId?: string;
  status?: RunDocument['status'];
  limit?: number;
  offset?: number;
}): Promise<ListRunsResult> {
  const params = new URLSearchParams();
  if (options?.jobId) {
    params.set('jobId', options.jobId);
  }
  if (options?.status) {
    params.set('status', options.status);
  }
  if (typeof options?.limit === 'number') {
    params.set('limit', String(options.limit));
  }
  if (typeof options?.offset === 'number') {
    params.set('offset', String(options.offset));
  }
  const query = params.toString();
  const path = query ? `/runs?${query}` : '/runs';
  const response = await apiFetch(path);
  await throwForNonOk(response);
  return normalizeListRunsPayload(await parseJson<unknown>(response));
}

export async function getRun(id: string): Promise<RunDocument> {
  const response = await apiFetch(`/runs/${encodeURIComponent(id)}`);
  await throwForNonOk(response);
  return parseJson<RunDocument>(response);
}

export async function deleteRun(id: string): Promise<void> {
  const response = await apiFetch(`/runs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await throwForNonOk(response);
}
