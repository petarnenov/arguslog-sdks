import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArguslogApiError, ArguslogClient } from '../client.js';

describe('ArguslogClient', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.ARGUSLOG_PAT;
    delete process.env.ARGUSLOG_API_URL;
  });

  it('fromEnv throws a helpful error when ARGUSLOG_PAT is unset', () => {
    expect(() => ArguslogClient.fromEnv()).toThrow(/ARGUSLOG_PAT/);
  });

  it('builds an authenticated request with query params', async () => {
    process.env.ARGUSLOG_PAT = 'arglog_pat_test';
    process.env.ARGUSLOG_API_URL = 'https://api.example.com';
    const fetchMock = vi.fn(
      async (_url: URL | string, _opts?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = ArguslogClient.fromEnv();
    const out = await client.request<{ ok: boolean }>({
      method: 'GET',
      path: '/api/v1/orgs',
      query: { q: 'acme', limit: 25, ignored: undefined },
    });
    expect(out).toEqual({ ok: true });
    const call = fetchMock.mock.calls[0]!;
    const calledUrl = call[0] as URL;
    const calledOpts = call[1] as RequestInit;
    expect(calledUrl.toString()).toBe('https://api.example.com/api/v1/orgs?q=acme&limit=25');
    const headers = calledOpts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer arglog_pat_test');
  });

  it('JSON-encodes a body and sets Content-Type', async () => {
    process.env.ARGUSLOG_PAT = 'arglog_pat_test';
    const fetchMock = vi.fn(
      async (_url: URL | string, _opts?: RequestInit) => new Response(null, { status: 204 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = ArguslogClient.fromEnv();
    await client.request({
      method: 'POST',
      path: '/api/v1/orgs',
      body: { name: 'Acme' },
    });
    const opts = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(opts.body).toBe('{"name":"Acme"}');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws ArguslogApiError on a 4xx response with the parsed problem body', async () => {
    process.env.ARGUSLOG_PAT = 'arglog_pat_test';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ title: 'Forbidden', detail: 'Not an admin.' }), {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        }),
    ) as unknown as typeof globalThis.fetch;

    const client = ArguslogClient.fromEnv();
    await expect(
      client.request({ method: 'GET', path: '/api/v1/admin/stats' }),
    ).rejects.toMatchObject({
      status: 403,
      problem: { detail: 'Not an admin.' },
    });
    await expect(
      client.request({ method: 'GET', path: '/api/v1/admin/stats' }).catch((e) => e),
    ).resolves.toBeInstanceOf(ArguslogApiError);
  });
});
