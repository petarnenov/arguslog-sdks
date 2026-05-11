import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { InvalidDsnError, parseDsn } from '../dsn.js';

// Single canonical fixture file consumed by the TS, Java and Python SDK test suites. Adding a
// new edge case here means all three SDKs run it on next CI; whichever fails the parity check
// gets fixed. Prevents the "fixed it in TS, forgot Java" drift that bit us 2026-05-09.
//
// Path math: this file lives at packages/sdk-core/src/__tests__/dsn.fixtures.test.ts; the
// fixtures live at scripts/dsn-test-fixtures.json — four levels up plus into scripts.
const FIXTURES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../scripts/dsn-test-fixtures.json',
);

interface Fixture {
  name: string;
  dsn: string;
  valid: boolean;
  publicKey?: string;
  host?: string;
  projectId?: string;
  scheme?: 'http' | 'https';
  ingestUrl?: string;
}

const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf-8')) as Fixture[];

describe('parseDsn (shared fixtures)', () => {
  for (const fx of fixtures) {
    it(fx.name, () => {
      if (!fx.valid) {
        expect(() => parseDsn(fx.dsn)).toThrow(InvalidDsnError);
        return;
      }
      const out = parseDsn(fx.dsn);
      if (fx.scheme !== undefined) expect(out.protocol).toBe(fx.scheme);
      if (fx.publicKey !== undefined) expect(out.publicKey).toBe(fx.publicKey);
      if (fx.host !== undefined) expect(out.host).toBe(fx.host);
      if (fx.projectId !== undefined) expect(out.projectId).toBe(fx.projectId);
      if (fx.ingestUrl !== undefined) expect(out.ingestUrl).toBe(fx.ingestUrl);
    });
  }
});
