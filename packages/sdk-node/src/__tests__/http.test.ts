import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { EventPayload } from '@arguslog/sdk-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetForTests, captureMessage, flush, init } from '../index.js';

interface TestServer {
  port: number;
  close: () => Promise<void>;
}

function startServer(handler: http.RequestListener): Promise<TestServer> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('http integration', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sent: EventPayload[];
  let server: TestServer | undefined;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    sent = [];
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(init?.body as string) as EventPayload);
      return new Response(null, { status: 202 });
    });
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
      integrations: ['http'],
    });
  });

  afterEach(async () => {
    __resetForTests();
    // Belt-and-suspenders: ensure global fetch is restored even if a test path failed before
    // hitting __resetForTests.
    globalThis.fetch = originalFetch;
    await server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  it('records a breadcrumb for http.request (200 OK)', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    await new Promise<void>((resolve, reject) => {
      // Use 'localhost' instead of '127.0.0.1' so the URL survives the IPv4 scrubber.
      const req = http.request(`http://localhost:${server!.port}/hello`, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });

    captureMessage('after-request');
    await flush();

    const ev = sent.find((e) => e.message === 'after-request');
    const crumb = ev?.breadcrumbs?.find((b) => b.category === 'http');
    expect(crumb).toBeDefined();
    expect(crumb?.message).toBe(`GET http://localhost:${server.port}/hello`);
    expect(crumb?.data).toMatchObject({
      method: 'GET',
      status_code: 200,
    });
    expect(crumb?.level).toBe('info');
  });

  it('marks 5xx responses as error level breadcrumbs', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('down');
    });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(`http://localhost:${server!.port}/`, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });

    captureMessage('after-503');
    await flush();
    const crumb = sent.find((e) => e.message === 'after-503')?.breadcrumbs?.[0];
    expect(crumb?.level).toBe('error');
    expect(crumb?.data).toMatchObject({ status_code: 503 });
  });

  it('records a breadcrumb for globalThis.fetch', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    const url = `http://localhost:${server.port}/api`;
    await fetch(url, { method: 'POST' });

    captureMessage('after-fetch');
    await flush();

    const ev = sent.find((e) => e.message === 'after-fetch');
    const crumb = ev?.breadcrumbs?.find((b) => b.category === 'http' && b.message.includes('POST'));
    expect(crumb).toBeDefined();
    expect(crumb?.data).toMatchObject({ method: 'POST', url, status_code: 200 });
  });

  it("does NOT record breadcrumbs for the SDK's own outbound DSN traffic", async () => {
    // The SDK transport emits POST /api/1/events with X-Arguslog-Auth.
    // captureMessage triggers a transport flush — if our integration didn't filter the SDK's
    // own fetch calls we'd get a self-referential breadcrumb feedback loop.
    captureMessage('first');
    await flush();
    captureMessage('second');
    await flush();

    const second = sent.find((e) => e.message === 'second');
    const httpBreadcrumbs = second?.breadcrumbs?.filter((b) => b.category === 'http') ?? [];
    expect(httpBreadcrumbs).toHaveLength(0);
  });

  it('records a breadcrumb when a fetch throws', async () => {
    // Hit a port nothing is listening on (localhost so the URL survives the IPv4 scrubber).
    await fetch('http://localhost:1/never').catch(() => undefined);
    captureMessage('after-failed-fetch');
    await flush();

    const crumb = sent
      .find((e) => e.message === 'after-failed-fetch')
      ?.breadcrumbs?.find((b) => b.category === 'http');
    expect(crumb?.level).toBe('error');
    expect(crumb?.data?.error).toBeDefined();
  });

  it('uninstalls cleanly on __resetForTests', async () => {
    const beforePatched = globalThis.fetch;
    __resetForTests();
    expect(globalThis.fetch).not.toBe(beforePatched);
    expect(globalThis.fetch).toBe(originalFetch);
  });
});
