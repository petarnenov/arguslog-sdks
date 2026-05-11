import type { ParsedDsn } from './types.js';

// User-facing DSN format (matches what the api emits in the project-create response and shows in
// the web UI's "Copy DSN" modal): arguslog://<publicKey>@<host>/api/<projectId>
//
// The custom `arguslog://` scheme keeps the DSN string visually distinct from the actual transport
// URL and prevents users from copy-pasting it into a browser hoping it'll open something. The SDK
// derives the real transport scheme from the host: localhost / loopback / RFC1918 → http (dev),
// everything else → https.
const DSN_RE = /^arguslog:\/\/([^@]+)@([^/]+)\/api\/([^/?#]+)$/;

export class InvalidDsnError extends Error {
  constructor(dsn: string) {
    super(`Invalid Arguslog DSN: ${dsn}`);
    this.name = 'InvalidDsnError';
  }
}

export function parseDsn(dsn: string): ParsedDsn {
  const match = DSN_RE.exec(dsn);
  if (!match) {
    throw new InvalidDsnError(dsn);
  }
  const [, publicKey, host, projectId] = match;
  if (!publicKey || !host || !projectId) {
    throw new InvalidDsnError(dsn);
  }
  const protocol: 'http' | 'https' = isDevHost(host) ? 'http' : 'https';
  return {
    protocol,
    publicKey,
    host,
    projectId,
    ingestUrl: `${protocol}://${host}/api/${projectId}/events`,
  };
}

function isDevHost(host: string): boolean {
  // IPv6 literals come bracketed (e.g. [::1]:8080); strip the [..] part. IPv4/hostnames have a
  // single optional :port suffix.
  const bare = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : (host.split(':')[0] ?? host);
  if (
    bare === 'localhost' ||
    bare.startsWith('127.') ||
    bare === '0.0.0.0' ||
    bare === '[::1]' ||
    bare === '::1'
  ) {
    return true;
  }
  // RFC1918 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. A device on the same LAN
  // pointing at the dev box's LAN IP (e.g. 192.168.x.y) is still a dev-mode transport — Spring
  // Boot ingest only listens on plain HTTP locally; without this, the SDK would upgrade to HTTPS
  // and fail the TLS handshake silently.
  const parts = bare.split('.').map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
