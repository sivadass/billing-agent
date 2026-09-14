import { ApiClientError, apiFetch } from './api-client';
import type { JobDocument, JobPatch, JobSecretKey } from './types';

type RunJobNowResponse = {
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

export async function listJobs(): Promise<JobDocument[]> {
  const response = await apiFetch('/jobs');
  await throwForNonOk(response);
  return parseJson<JobDocument[]>(response);
}

export async function getJob(id: string): Promise<JobDocument> {
  const response = await apiFetch(`/jobs/${encodeURIComponent(id)}`);
  await throwForNonOk(response);
  return parseJson<JobDocument>(response);
}

export async function updateJob(
  id: string,
  patch: Partial<JobPatch>,
): Promise<JobDocument> {
  const response = await apiFetch(`/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await throwForNonOk(response);
  return parseJson<JobDocument>(response);
}

export async function disableJob(id: string): Promise<JobDocument> {
  const response = await apiFetch(`/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await throwForNonOk(response);
  return parseJson<JobDocument>(response);
}

export async function getJobSecrets(id: string): Promise<JobSecretKey[]> {
  const response = await apiFetch(`/jobs/${encodeURIComponent(id)}/secrets`);
  await throwForNonOk(response);
  return (await parseJson<{ keys: JobSecretKey[] }>(response)).keys;
}

/** Write-only: values leave the browser and never come back. */
export async function updateJobSecrets(
  id: string,
  values: Record<string, string>,
): Promise<JobSecretKey[]> {
  const response = await apiFetch(`/jobs/${encodeURIComponent(id)}/secrets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  await throwForNonOk(response);
  return (await parseJson<{ keys: JobSecretKey[] }>(response)).keys;
}

export async function runJobNow(id: string): Promise<RunJobNowResponse> {
  const response = await apiFetch(`/jobs/${encodeURIComponent(id)}/run`, {
    method: 'POST',
  });
  await throwForNonOk(response);
  return parseJson<RunJobNowResponse>(response);
}
