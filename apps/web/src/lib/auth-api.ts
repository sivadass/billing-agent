import { ApiClientError, apiFetch } from './api-client';
import { setAccessToken } from './auth-token';

export type LoginResult = {
  token: string;
  user: { id: string; email: string };
};

export async function login(email: string, password: string): Promise<LoginResult> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    let message = 'Invalid email or password';
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.trim()) {
        message = body.error;
      }
    } catch {
      // keep generic message
    }
    throw new ApiClientError(message, 'http', response.status);
  }

  const body = (await response.json()) as LoginResult;
  if (!body.token || !body.user?.id || !body.user?.email) {
    throw new ApiClientError('Invalid login response', 'http', response.status);
  }

  setAccessToken(body.token);
  return body;
}
