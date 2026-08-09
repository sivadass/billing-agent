import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_STORAGE_KEY } from './auth-token';
import { apiFetch } from './api-client';

describe('apiFetch', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8080');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('sends Authorization Bearer from session JWT', async () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-token');
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
    expect(headers.get('Authorization')).toBe('Bearer jwt-token');
  });

  it('omits Authorization when no token is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('clears token and redirects to /login on 401', async () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, 'expired-jwt');
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/jobs');

    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('does not redirect on 401 for login requests', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/auth/login', { method: 'POST', body: '{}' });

    expect(assign).not.toHaveBeenCalled();
  });
});
