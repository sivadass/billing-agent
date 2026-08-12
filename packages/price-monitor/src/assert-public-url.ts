import { isIP } from 'node:net';

export class PublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicUrlError';
  }
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  return false;
}

export function assertPublicHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PublicUrlError('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PublicUrlError('Only http(s) URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new PublicUrlError('URLs with credentials are not allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalizedHost = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost.endsWith('.local') ||
    normalizedHost.endsWith('.internal')
  ) {
    throw new PublicUrlError('Local or internal hostnames are not allowed');
  }

  const ipKind = isIP(normalizedHost);
  if (ipKind === 4 && isBlockedIpv4(normalizedHost)) {
    throw new PublicUrlError('Private or loopback IPv4 addresses are not allowed');
  }
  if (ipKind === 6 && isBlockedIpv6(normalizedHost)) {
    throw new PublicUrlError('Private or loopback IPv6 addresses are not allowed');
  }

  return parsed;
}
