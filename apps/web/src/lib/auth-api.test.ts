import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_STORAGE_KEY } from './auth-token';
import { login } from './auth-api';

describe('login', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8080');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('posts credentials and stores the JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'jwt-from-login',
          user: { id: 'u1', email: 'you@example.com' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await login('you@example.com', 'secret');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'you@example.com',
      password: 'secret',
    });
    expect(result.token).toBe('jwt-from-login');
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-from-login');
  });

  it('throws on invalid credentials without storing a token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401 }),
      ),
    );

    await expect(login('you@example.com', 'wrong')).rejects.toThrow('Invalid email or password');
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});
