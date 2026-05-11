#!/usr/bin/env node
/**
 * HTTP entry point for {@code @arguslog/mcp-server}. Lets the same MCP tool catalog be hosted
 * publicly on {@code mcp.arguslog.org} instead of every user installing the npm package
 * locally. Per-request PAT auth means one shared deployment serves any number of users — each
 * one sends their own Bearer token, the server uses it to fan out to the Arguslog API on
 * their behalf.
 *
 * <p>Speaks MCP Streamable HTTP (the post-1.0 transport): one POST endpoint accepting JSON-RPC
 * requests, optionally upgrading to SSE for server-initiated messages. We run in
 * <i>stateless</i> mode (no session ids) — every tool call is independent, no need for
 * persistent SSE streams.
 *
 * <p>Auth: client sends {@code Authorization: Bearer arglog_pat_<rest>} on every request. We
 * mint a fresh {@link ArguslogClient} per request so leakage between requests is structurally
 * impossible. Missing / empty bearer is NOT rejected at the HTTP layer — that would trigger
 * OAuth-discovery in gateways like Smithery / Glama (they read {@code WWW-Authenticate: Bearer}
 * as an OAuth challenge instead of forwarding the user's PAT). Instead we surface an MCP-level
 * error from {@code tools/call}; metadata methods like {@code initialize} and
 * {@code tools/list} work unauthenticated so discovery probes succeed.
 *
 * <p>Defense in depth: {@link helmet} for default secure response headers,
 * {@link rateLimit per-PAT rate limiting} so a leaked or abusive PAT can't exhaust the
 * process, and an optional Cloudflare origin-token check that closes the
 * {@code *.up.railway.app} bypass when {@code CF_ORIGIN_TOKEN} is configured.
 *
 * <p>Health: {@code GET /healthz} returns 200 OK so Railway's healthchecks don't churn the
 * service. It is intentionally excluded from the Cloudflare guard (Railway's healthcheck
 * doesn't traverse the CDN) and from rate limiting. Everything else under {@code /} returns
 * 404.
 */
import crypto from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express, { type Application, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { ArguslogApiError, ArguslogClient } from './client.js';
import { executeTool, listMcpTools } from './tools.js';

const PACKAGE_NAME = '@arguslog/mcp-server';
const PACKAGE_VERSION = '0.4.2';

const PORT = Number(process.env.PORT ?? 8080);
const ARGUSLOG_API_URL = process.env.ARGUSLOG_API_URL ?? 'https://api.arguslog.org';

function extractPat(req: Request): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return null;
  const trimmed = header.trim();
  // Accept both "Bearer arglog_pat_..." (RFC 6750 standard) and raw "arglog_pat_..."
  // The latter shape is what Smithery's gateway forwards when the user enters their PAT
  // into the connection config — Smithery doesn't auto-prefix with "Bearer ".
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (bearerMatch) {
    const tok = bearerMatch[1]?.trim();
    return tok && tok.length > 0 ? tok : null;
  }
  // Raw PAT — must look like one (starts with "arglog_pat_") so we don't accept random junk.
  if (trimmed.startsWith('arglog_pat_')) return trimmed;
  return null;
}

/** Constant-time string equality. Plain {@code ===} would let an attacker probe the secret
 * one byte at a time off response latency; {@link crypto.timingSafeEqual} does not. */
function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Hash a PAT into a stable, non-reversible key for the rate-limit store. We never want the
 * raw token to live in an in-memory map even briefly — sha256(prefix) is plenty for a counter
 * key. */
function patRateKey(pat: string): string {
  return 'pat:' + crypto.createHash('sha256').update(pat).digest('hex').slice(0, 16);
}

/** Builds a one-shot MCP {@link Server} bound to the request's PAT (or null when the
 * caller is a discovery probe with no auth — only initialize / tools/list / etc work in
 * that case; tools/call returns a friendly error pointing at the dashboard).
 */
function makeServer(client: ArguslogClient | null): Server {
  const server = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  // Static tool catalog — no API call, always works regardless of auth. This is what
  // Smithery / Glama / other gateways probe with on first connection.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listMcpTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (!client) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              'Authentication required. Configure ARGUSLOG_PAT (Authorization: Bearer ' +
              'arglog_pat_<rest>) on your MCP client — generate one from the Arguslog ' +
              'dashboard → Personal access tokens.',
          },
        ],
      };
    }
    const { name, arguments: args } = req.params;
    try {
      const result = await executeTool(client, name, (args ?? {}) as Record<string, unknown>);
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      if (err instanceof ArguslogApiError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                `Arguslog API error ${err.status} on ${err.url}\n` +
                (err.problem ? JSON.stringify(err.problem, null, 2) : err.message),
            },
          ],
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });

  return server;
}

async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  // We DON'T reject requests with missing Bearer at the HTTP layer — that triggers
  // OAuth-discovery in MCP gateways like Smithery (they see the WWW-Authenticate
  // header and try to negotiate OAuth instead of forwarding the user's PAT).
  // Instead: build a null client when no PAT is present; tools/list still works
  // (static catalog), tools/call fails with a clear in-band MCP error.
  const pat = extractPat(req);
  const client = pat ? new ArguslogClient({ baseUrl: ARGUSLOG_API_URL, pat }) : null;

  // Stateless transport — sessionIdGenerator undefined → no session ids, every request
  // stands alone. We rebuild the Server per request so the PAT scope is the request's
  // lifetime, not the process's.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = makeServer(client);

  // Wire up cleanup on response end so listeners don't pile up on a long-lived process.
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

/** Cloudflare origin-token middleware. Closes the {@code *.up.railway.app} bypass: when
 * {@code CF_ORIGIN_TOKEN} is set, a Cloudflare Transform Rule injects the same value into
 * {@code X-CF-Origin-Token} on every request that traverses the CDN. Requests that don't
 * carry the token (i.e. direct origin hits) get 403. Returns {@code null} when the env
 * var is unset — local dev and the first deployment of this change skip the guard. */
function makeCfOriginGuard(): RequestHandler | null {
  const expected = (process.env.CF_ORIGIN_TOKEN ?? '').trim();
  if (!expected) return null;
  return (req, res, next) => {
    const provided = req.header('x-cf-origin-token') ?? '';
    if (!provided || !timingSafeEq(provided, expected)) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Forbidden: origin token missing or invalid.',
        },
        id: null,
      });
      return;
    }
    next();
  };
}

/** Per-PAT (or per-IP when no PAT) rate limiter. Default 120 req/min; tunable via env so we
 * can dial it without a redeploy. Healthz is NOT routed through this — it's mounted
 * before the limiter binds. */
function makeRateLimiter(): RequestHandler {
  const perMinute = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? 120);
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const pat = extractPat(req);
      if (pat) return patRateKey(pat);
      return `ip:${req.ip ?? 'unknown'}`;
    },
    handler: (_req, res) => {
      res.status(429).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Rate limit exceeded. Try again in a minute.',
        },
        id: null,
      });
    },
  });
}

/** Build the Express app. Exported so tests can drive it without a live listen(). */
export function createApp(): Application {
  const app = express();

  // Don't advertise the implementation — minor info leak, free to plug.
  app.disable('x-powered-by');

  // Railway terminates TLS one hop in front of us; X-Forwarded-For is rewritten there. Trust
  // exactly one proxy so req.ip resolves to the real client and the rate limiter doesn't
  // bucket all traffic under the Railway edge IP.
  app.set('trust proxy', 1);

  // Secure default response headers (HSTS, X-Content-Type-Options, X-DNS-Prefetch-Control, …).
  // We're a JSON API, so the CSP default of `default-src 'self'` doesn't gate any real
  // browser content — leaving it on is harmless and pleases scanners.
  app.use(helmet());

  app.use(express.json({ limit: '1mb' }));

  // Healthz first, before any auth-ish middleware — Railway's healthcheck doesn't traverse
  // Cloudflare and can't send the origin token. Keeping it out of rate-limiting prevents a
  // dependency between a misconfigured limiter and uptime reporting.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, service: PACKAGE_NAME, version: PACKAGE_VERSION });
  });

  // /mcp gets the full security stack: optional CF origin guard → rate limiter → handler.
  const mcpStack: RequestHandler[] = [];
  const cfGuard = makeCfOriginGuard();
  if (cfGuard) mcpStack.push(cfGuard);
  mcpStack.push(makeRateLimiter());

  app.post('/mcp', ...mcpStack, (req, res) => {
    handleMcpRequest(req, res).catch((err) => {
      process.stderr.write(`[${PACKAGE_NAME}] handler error: ${err}\n`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    });
  });

  // Streamable HTTP also defines GET /mcp for resumable SSE streams. We're stateless so we
  // refuse — clients fall back to single-shot POST which is what we support. Guarded so the
  // 405 surfaces even when the CF token is missing (no info leak; method/transport is public).
  app.get('/mcp', ...mcpStack, (_req, res) => {
    res
      .status(405)
      .json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'GET /mcp is not supported. This server runs in stateless mode — POST only.',
        },
        id: null,
      });
  });

  return app;
}

function main(): void {
  const app = createApp();

  app.listen(PORT, () => {
    process.stderr.write(
      `[${PACKAGE_NAME}] HTTP listening on :${PORT}, upstream = ${ARGUSLOG_API_URL}\n`,
    );
  });
}

// ESM `import.meta.url` check: only run main when this file is the process entry point so
// `import { createApp } from './http.js'` in tests doesn't accidentally start a listener.
const isEntryPoint = (() => {
  if (typeof process.argv[1] !== 'string') return false;
  try {
    const entryUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  main();
}
