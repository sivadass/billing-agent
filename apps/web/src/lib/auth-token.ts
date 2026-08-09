export const TOKEN_STORAGE_KEY = 'billing-agent.api-token';

export function getApiToken(): string | null {
  const override = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (override && override.trim()) return override.trim();

  const envToken = import.meta.env.VITE_API_TOKEN;
  if (typeof envToken === 'string' && envToken.trim()) return envToken.trim();

  return null;
}

export function setApiTokenOverride(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
}

export function clearApiTokenOverride(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getApiBaseUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (typeof base !== 'string' || !base.trim()) {
    throw new Error('VITE_API_BASE_URL is required');
  }
  return base.replace(/\/+$/, '');
}
