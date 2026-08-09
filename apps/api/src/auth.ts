import type { IncomingMessage, ServerResponse } from 'node:http';

function unauthorized(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

export function requireBearerAuth(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    unauthorized(res);
    return false;
  }

  const provided = header.slice('Bearer '.length);
  if (provided !== token) {
    unauthorized(res);
    return false;
  }

  return true;
}
