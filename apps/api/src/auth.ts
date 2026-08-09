import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyAccessToken, type AccessTokenClaims } from './jwt.js';

function unauthorized(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

export async function requireJwtAuth(
  req: IncomingMessage,
  res: ServerResponse,
  jwtSecret: string,
): Promise<AccessTokenClaims | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    unauthorized(res);
    return null;
  }

  const token = header.slice('Bearer '.length);
  const claims = await verifyAccessToken(token, jwtSecret);
  if (!claims) {
    unauthorized(res);
    return null;
  }

  return claims;
}
