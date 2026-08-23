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
  // 0.0.0.0/8: `0.0.0.0` reaches every local interface, so it is another
  // spelling of localhost, and the rest of the range is unroutable anyway.
  if (a === 0) return true;
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

/**
 * Expands an IPv6 literal (any `::` compression, optional trailing dotted quad,
 * optional zone id) into its eight 16-bit groups. Returns `null` for anything it
 * cannot parse — callers then fall back to the textual checks.
 */
function parseIpv6Groups(raw: string): number[] | null {
  let text = raw.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);

  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const octets = dotted[1].split('.').map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null;
    }
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, dotted.index)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const parts =
    halves.length === 2
      ? [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail]
      : head;
  if (parts.length !== 8) return null;

  const groups = parts.map((part) =>
    /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN,
  );
  return groups.some(Number.isNaN) ? null : groups;
}

/**
 * IPv4-mapped (`::ffff:127.0.0.1`, `::ffff:7f00:1`) and IPv4-compatible
 * (`::127.0.0.1`) forms reach the embedded IPv4 address, so they must face the
 * IPv4 rules rather than sliding past the IPv6 prefix checks.
 */
function embeddedIpv4(hostname: string): string | null {
  const groups = parseIpv6Groups(hostname);
  if (!groups) return null;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (g0 || g1 || g2 || g3 || g4) return null;
  if (g5 !== 0 && g5 !== 0xffff) return null;
  return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
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
  if (ipKind === 6) {
    if (isBlockedIpv6(normalizedHost)) {
      throw new PublicUrlError('Private or loopback IPv6 addresses are not allowed');
    }
    const mapped = embeddedIpv4(normalizedHost);
    if (mapped && isBlockedIpv4(mapped)) {
      throw new PublicUrlError(
        'IPv4-mapped private or loopback addresses are not allowed',
      );
    }
  }

  return parsed;
}
