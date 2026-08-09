export type DecodedAccessToken = {
  userId: string;
  email: string;
};

function decodeBase64UrlJson(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLength);
  const json = atob(base64);
  return JSON.parse(json) as unknown;
}

export function decodeAccessToken(token: string): DecodedAccessToken | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = decodeBase64UrlJson(parts[1]!);
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const userId = record.sub;
    const email = record.email;
    if (typeof userId !== 'string' || typeof email !== 'string') return null;
    if (!userId || !email) return null;
    return { userId, email };
  } catch {
    return null;
  }
}
