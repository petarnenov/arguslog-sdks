import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../cli.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('releases new', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs the version with bearer auth and prints the new release id', async () => {
    const captured: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      captured.push({ url: typeof input === 'string' ? input : (input as Request).url, init });
      return jsonResponse({ id: 7, projectId: 101, version: '1.2.3', createdAt: 'now' }, 201);
    }) as typeof fetch;

    const result = await run(['releases', 'new', '1.2.3', '--project', '101'], {
      loadConfig: () => ({ apiBaseUrl: 'http://api', token: 'arglog_pat_x' }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('release #7 created: 1.2.3');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe('http://api/api/v1/projects/101/releases');
    const headers = new Headers(captured[0]!.init!.headers);
    expect(headers.get('Authorization')).toBe('Bearer arglog_pat_x');
    expect(JSON.parse(captured[0]!.init!.body as string)).toEqual({ version: '1.2.3' });
  });

  it('surfaces api 409 as a friendly error and exit 1', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ title: 'Duplicate release', status: 409, detail: 'exists' }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        ),
    ) as typeof fetch;

    const result = await run(['releases', 'new', '1.2.3', '--project', '101'], {
      loadConfig: () => ({ apiBaseUrl: 'http://api', token: 'arglog_pat_x' }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('api 409');
    expect(result.stderr).toContain('exists');
  });
});
