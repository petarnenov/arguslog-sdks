import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../cli.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tempFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arglog-cli-test-'));
  const file = join(dir, 'app.js.map');
  writeFileSync(file, contents);
  return file;
}

describe('sourcemaps upload', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs metadata then PUTs bytes to the presigned URL and reports success', async () => {
    const file = tempFile('{"version":3,"sources":[]}');
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      calls.push({ url, init });
      if (url.endsWith('/sourcemaps') && init?.method === 'POST') {
        return jsonResponse(
          {
            artifact: {
              id: 42,
              releaseId: 7,
              r2Key: '1/101/7/dist/app.js.map',
              originalPath: 'dist/app.js',
              sha256: 'a'.repeat(64),
              sizeBytes: 26,
              createdAt: 'now',
            },
            uploadUrl: 'http://r2.example/upload?sig=abc',
            expiresAt: 'soon',
          },
          201,
        );
      }
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const result = await run(
      ['sourcemaps', 'upload', file, '--project', '101', '--release', '7', '--name', 'dist/app.js'],
      { loadConfig: () => ({ apiBaseUrl: 'http://api', token: 'arglog_pat_x' }) },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('sourcemap #42 uploaded');

    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post).toBeDefined();
    const body = JSON.parse(post!.init!.body as string) as Record<string, unknown>;
    expect(body.originalPath).toBe('dist/app.js');
    expect(body.sizeBytes).toBe(26);
    expect((body.sha256 as string).length).toBe(64);

    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put).toBeDefined();
    expect(put!.url).toBe('http://r2.example/upload?sig=abc');
  });

  it('reports the api 400 problem and does not attempt a PUT', async () => {
    const file = tempFile('payload');
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(
        JSON.stringify({
          title: 'Invalid sourcemap upload',
          status: 400,
          detail: 'sizeBytes must be 50 MiB or fewer',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      );
    }) as typeof fetch;

    const result = await run(['sourcemaps', 'upload', file, '--project', '101', '--release', '7'], {
      loadConfig: () => ({ apiBaseUrl: 'http://api', token: 'arglog_pat_x' }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('api 400');
    // No PUT — only the failed POST.
    expect(calls.filter((c) => c.startsWith('PUT'))).toHaveLength(0);
  });

  it('reports R2 upload failure separately so user knows to retry', async () => {
    const file = tempFile('payload');
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/sourcemaps') && init?.method === 'POST') {
        return jsonResponse({
          artifact: {
            id: 42,
            releaseId: 7,
            r2Key: 'k',
            originalPath: 'a',
            sha256: 'a'.repeat(64),
            sizeBytes: 7,
            createdAt: 'now',
          },
          uploadUrl: 'http://r2.example/upload',
          expiresAt: 'soon',
        });
      }
      return new Response('access denied', { status: 403 });
    }) as typeof fetch;

    const result = await run(['sourcemaps', 'upload', file, '--project', '101', '--release', '7'], {
      loadConfig: () => ({ apiBaseUrl: 'http://api', token: 'arglog_pat_x' }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('upload to R2 failed');
    expect(result.stderr).toContain('403');
  });
});
