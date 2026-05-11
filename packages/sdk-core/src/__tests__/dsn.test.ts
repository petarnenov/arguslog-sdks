import { describe, expect, it } from 'vitest';

import { InvalidDsnError, parseDsn } from '../dsn.js';

describe('parseDsn', () => {
  it('parses a production DSN and picks https transport for non-loopback hosts', () => {
    const dsn = parseDsn('arguslog://abc123@ingest.arguslog.io/api/42');
    expect(dsn).toEqual({
      protocol: 'https',
      publicKey: 'abc123',
      host: 'ingest.arguslog.io',
      projectId: '42',
      ingestUrl: 'https://ingest.arguslog.io/api/42/events',
    });
  });

  it('picks http transport for localhost', () => {
    const dsn = parseDsn('arguslog://key@localhost:8080/api/1');
    expect(dsn.protocol).toBe('http');
    expect(dsn.ingestUrl).toBe('http://localhost:8080/api/1/events');
  });

  it('picks http transport for 127.0.0.1', () => {
    expect(parseDsn('arguslog://k@127.0.0.1:8080/api/1').protocol).toBe('http');
  });

  // RFC1918 + just-outside-the-range cases live in scripts/dsn-test-fixtures.json so the
  // TS, Java and Python SDKs all run identical assertions; see dsn.fixtures.test.ts.

  it.each([
    'not-a-dsn',
    '',
    // missing public key
    'arguslog://@arguslog.io/api/42',
    // wrong scheme
    'https://key@arguslog.io/api/42',
    // wrong path prefix
    'arguslog://key@arguslog.io/42',
    // empty project id
    'arguslog://key@arguslog.io/api/',
  ])('rejects invalid DSN: %s', (bad) => {
    expect(() => parseDsn(bad)).toThrow(InvalidDsnError);
  });
});
