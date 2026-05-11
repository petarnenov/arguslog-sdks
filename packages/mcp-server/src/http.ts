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
 * <p>Health: {@code GET /healthz} returns 200 OK so Railway's healthchecks don't churn the
 * service. Everything else under {@code /} returns 404.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response } from 'express';

import { ArguslogApiError, ArguslogClient } from './client.js';
import { executeTool, listMcpTools } from './tools.js';

const PACKAGE_NAME = '@arguslog/mcp-server';
const PACKAGE_VERSION = '0.2.2';

const PORT = Number(process.env.PORT ?? 8080);
const ARGUSLOG_API_URL = process.env.ARGUSLOG_API_URL ?? 'https://api.arguslog.org';

function extractPat(req: Request): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const tok = match[1]?.trim();
  return tok && tok.length > 0 ? tok : null;
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

function main(): void {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, service: PACKAGE_NAME, version: PACKAGE_VERSION });
  });

  app.post('/mcp', (req, res) => {
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
  // refuse — clients fall back to single-shot POST which is what we support.
  app.get('/mcp', (_req, res) => {
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

  app.listen(PORT, () => {
    process.stderr.write(
      `[${PACKAGE_NAME}] HTTP listening on :${PORT}, upstream = ${ARGUSLOG_API_URL}\n`,
    );
  });
}

main();
