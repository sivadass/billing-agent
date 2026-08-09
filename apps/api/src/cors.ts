import type { IncomingMessage, ServerResponse } from 'node:http';

export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  corsOrigins: string[],
): { handled: boolean } {
  const originHeader = req.headers.origin;
  const origin = typeof originHeader === 'string' ? originHeader : undefined;

  if (origin && corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }

  if ((req.method ?? 'GET') === 'OPTIONS' && corsOrigins.length > 0) {
    res.statusCode = 204;
    res.end();
    return { handled: true };
  }

  return { handled: false };
}
