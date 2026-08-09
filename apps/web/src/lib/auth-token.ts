export const TOKEN_STORAGE_KEY = 'billing-agent.jwt';

export function getAccessToken(): string | null {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (token && token.trim()) return token.trim();
  return null;
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getApiBaseUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (typeof base !== 'string' || !base.trim()) {
    throw new Error('VITE_API_BASE_URL is required');
  }
  return base.replace(/\/+$/, '');
}
