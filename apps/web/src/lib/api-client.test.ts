import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_STORAGE_KEY } from './auth-token';
import { apiFetch } from './api-client';

describe('apiFetch', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('VITE_API_TOKEN', 'env-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('sends Authorization Bearer from resolved token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/jobs');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/jobs',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer env-token');
  });

  it('prefers session override for Bearer token', async () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, 'override-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer override-token');
  });

  it('omits Authorization when no token is available', async () => {
    vi.stubEnv('VITE_API_TOKEN', '');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
  });
});
