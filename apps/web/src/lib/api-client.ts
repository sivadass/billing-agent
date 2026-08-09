import { getApiBaseUrl, getApiToken } from './auth-token';

export class ApiClientError extends Error {
  readonly kind: 'network' | 'http';
  readonly status?: number;

  constructor(message: string, kind: 'network' | 'http', status?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = status;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${normalizedPath}`;

  const headers = new Headers(init.headers);
  const token = getApiToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  try {
    return await fetch(url, { ...init, headers });
  } catch {
    throw new ApiClientError('Cannot reach API', 'network');
  }
}
