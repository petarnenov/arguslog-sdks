import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFetchBreadcrumbs } from '../integrations/fetch-breadcrumbs.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

describe('installFetchBreadcrumbs', () => {
  const originalFetch = window.fetch;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    window.fetch = vi.fn(async () =>
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as typeof window.fetch;
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    window.fetch = originalFetch;
  });

  it('records info breadcrumb for 2xx responses', async () => {
    const client = fakeClient();
    uninstall = installFetchBreadcrumbs(client);
    const response = await fetch('https://api.example.com/users', { method: 'GET' });
    expect(response.status).toBe(200);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'fetch',
        level: 'info',
        message: 'GET https://api.example.com/users → 200',
      }),
    );
  });

  it('records warning breadcrumb for 4xx responses', async () => {
    const client = fakeClient();
    window.fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as typeof window.fetch;
    uninstall = installFetchBreadcrumbs(client);
    await fetch('/api/secret');
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('records error breadcrumb for 5xx responses', async () => {
    const client = fakeClient();
    window.fetch = vi.fn(async () => new Response('boom', { status: 502 })) as typeof window.fetch;
    uninstall = installFetchBreadcrumbs(client);
    await fetch('/api/x');
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('records breadcrumb and re-throws on network error', async () => {
    const client = fakeClient();
    window.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof window.fetch;
    uninstall = installFetchBreadcrumbs(client);
    await expect(fetch('/api/x')).rejects.toThrow('Failed to fetch');
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'fetch',
        level: 'error',
        message: 'GET /api/x — network error',
      }),
    );
  });

  it('captures a response body preview for 4xx JSON responses', async () => {
    const client = fakeClient();
    window.fetch = vi.fn(async () =>
      new Response('{"error":"NowPaymentsAuthFailed"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof window.fetch;
    uninstall = installFetchBreadcrumbs(client);
    await fetch('/api/x');
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 401,
          responsePreview: '{"error":"NowPaymentsAuthFailed"}',
        }),
      }),
    );
  });

  it('truncates response previews larger than 4KB', async () => {
    const client = fakeClient();
    const big = 'x'.repeat(5000);
    window.fetch = vi.fn(async () =>
      new Response(big, { status: 500, headers: { 'content-type': 'text/plain' } }),
    ) as typeof window.fetch;
    uninstall = installFetchBreadcrumbs(client);
    await fetch('/api/x');
    const call = (client.addBreadcrumb as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { responsePreview?: string };
    };
    expect(call.data.responsePreview).toContain('… (truncated)');
    expect(call.data.responsePreview!.length).toBeLessThanOrEqual(4096 + 30);
  });

  it('skips response preview for binary content types', async () => {
    const client = fakeClient();
    window.fetch = vi.fn(async () =>
      new Response('binary stuff', {
        status: 500,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    ) as typeof window.fetch;
    uninstall = installFetchBreadcrumbs(client);
    await fetch('/api/x');
    const call = (client.addBreadcrumb as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { responsePreview?: string };
    };
    expect(call.data.responsePreview).toBeUndefined();
  });

  it('does not capture response preview for 2xx', async () => {
    const client = fakeClient();
    uninstall = installFetchBreadcrumbs(client);
    await fetch('/api/ok');
    const call = (client.addBreadcrumb as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).not.toHaveProperty('responsePreview');
  });

  it('uninstall restores window.fetch', () => {
    const client = fakeClient();
    const before = window.fetch;
    uninstall = installFetchBreadcrumbs(client);
    expect(window.fetch).not.toBe(before);
    uninstall();
    uninstall = undefined;
    expect(window.fetch).toBe(before);
  });
});
