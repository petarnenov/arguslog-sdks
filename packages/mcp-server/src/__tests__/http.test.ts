/**
 * HTTP-layer security tests for {@code createApp}. Covers the three defense-in-depth
 * mitigations added on top of the per-request PAT auth model: no {@code X-Powered-By} leak,
 * a Cloudflare origin-token guard (closes the {@code *.up.railway.app} bypass), and the
 * per-PAT rate limiter. {@code /healthz} must remain reachable without either gate so
 * Railway healthchecks don't churn the service.
 */
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../http.js';

function listen(): Promise<{ server: HttpServer; url: string }> {
  return new Promise((resolve) => {
    const app = createApp();
    const server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server: HttpServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

const ENV_KEYS = ['CF_ORIGIN_TOKEN', 'MCP_RATE_LIMIT_PER_MINUTE'] as const;

describe('createApp — security middleware', () => {
  const originalEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  it('does not advertise the implementation in response headers', async () => {
    const { server, url } = await listen();
    try {
      const res = await fetch(`${url}/healthz`);
      expect(res.headers.get('x-powered-by')).toBeNull();
    } finally {
      await close(server);
    }
  });

  it('sets helmet default security headers on responses', async () => {
    const { server, url } = await listen();
    try {
      const res = await fetch(`${url}/healthz`);
      // helmet's most distinctive defaults — exact values can drift across major versions,
      // so we only assert presence.
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('strict-transport-security')).toBeTruthy();
    } finally {
      await close(server);
    }
  });

  it('healthz works without CF origin token (Railway healthcheck bypasses the CDN)', async () => {
    process.env.CF_ORIGIN_TOKEN = 'secret-token-value';
    const { server, url } = await listen();
    try {
      const res = await fetch(`${url}/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      await close(server);
    }
  });

  it('rejects /mcp without origin token when CF_ORIGIN_TOKEN is set', async () => {
    process.env.CF_ORIGIN_TOKEN = 'secret-token-value';
    const { server, url } = await listen();
    try {
      const res = await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: number } };
      expect(body.error.code).toBe(-32000);
    } finally {
      await close(server);
    }
  });

  it('rejects /mcp with a wrong origin token (constant-time mismatch)', async () => {
    process.env.CF_ORIGIN_TOKEN = 'secret-token-value';
    const { server, url } = await listen();
    try {
      const res = await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cf-origin-token': 'not-the-real-token',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      expect(res.status).toBe(403);
    } finally {
      await close(server);
    }
  });

  it('lets /mcp through when origin token matches', async () => {
    process.env.CF_ORIGIN_TOKEN = 'secret-token-value';
    const { server, url } = await listen();
    try {
      const res = await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
          'x-cf-origin-token': 'secret-token-value',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      // 200 with SSE body — the MCP transport accepted the request past the guard.
      expect(res.status).toBe(200);
    } finally {
      await close(server);
    }
  });

  it('CF guard is dormant when CF_ORIGIN_TOKEN is unset', async () => {
    delete process.env.CF_ORIGIN_TOKEN;
    const { server, url } = await listen();
    try {
      const res = await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      // No guard, no token needed — the MCP transport handles the request.
      expect(res.status).toBe(200);
    } finally {
      await close(server);
    }
  });

  it('rate-limits /mcp after the configured threshold', async () => {
    process.env.MCP_RATE_LIMIT_PER_MINUTE = '3';
    const { server, url } = await listen();
    try {
      const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
      const headers = {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': 'Bearer arglog_pat_ratelimit_test_token',
      };
      // First 3 should pass.
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${url}/mcp`, { method: 'POST', headers, body });
        expect(res.status).toBe(200);
        // Drain the body so the connection is released back to the pool — without this the
        // next request waits on the keep-alive socket and starts looking like a hang.
        await res.text();
      }
      // 4th should hit the limiter.
      const res = await fetch(`${url}/mcp`, { method: 'POST', headers, body });
      expect(res.status).toBe(429);
      const limitBody = (await res.json()) as { error: { message: string } };
      expect(limitBody.error.message).toMatch(/rate limit/i);
    } finally {
      await close(server);
    }
  });

  it('rate-limiter keys per-PAT, not per-IP — two PATs share the same loopback', async () => {
    process.env.MCP_RATE_LIMIT_PER_MINUTE = '2';
    const { server, url } = await listen();
    try {
      const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
      const mk = (pat: string) => ({
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${pat}`,
      });

      // Burn PAT-A's budget.
      for (let i = 0; i < 2; i++) {
        const r = await fetch(`${url}/mcp`, { method: 'POST', headers: mk('arglog_pat_AAA'), body });
        expect(r.status).toBe(200);
        await r.text();
      }
      const blocked = await fetch(`${url}/mcp`, { method: 'POST', headers: mk('arglog_pat_AAA'), body });
      expect(blocked.status).toBe(429);
      await blocked.text();

      // PAT-B still has full budget — proves the key isn't shared by client IP.
      const fresh = await fetch(`${url}/mcp`, { method: 'POST', headers: mk('arglog_pat_BBB'), body });
      expect(fresh.status).toBe(200);
    } finally {
      await close(server);
    }
  });

  it('healthz is exempt from rate limiting', async () => {
    process.env.MCP_RATE_LIMIT_PER_MINUTE = '2';
    const { server, url } = await listen();
    try {
      // Hammer healthz past the rate-limit threshold — should still all return 200.
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${url}/healthz`);
        expect(res.status).toBe(200);
      }
    } finally {
      await close(server);
    }
  });
});
