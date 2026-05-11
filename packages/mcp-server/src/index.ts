#!/usr/bin/env node
/**
 * Arguslog MCP server — stdio entry point. Designed to be wired as an MCP server in Claude
 * Desktop / Claude Code / Cursor / Continue / any client that speaks MCP over stdio. The user
 * provides their PAT via {@code ARGUSLOG_PAT}; the server reads it once on startup and reuses
 * it for every tool call.
 *
 * <p>Hidden config:
 * <ul>
 *   <li>{@code ARGUSLOG_API_URL} — base URL, defaults to {@code https://api.arguslog.org}.
 *       Override for self-hosted Arguslog or a staging environment.</li>
 *   <li>{@code ARGUSLOG_PAT} — required PAT bearer token.</li>
 * </ul>
 *
 * <p>Architecture is intentionally thin: tool list + dispatch live in {@link ./tools},
 * generation lives in {@link ./generated}, this file is just glue.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ArguslogApiError, ArguslogClient } from './client.js';
import { executeTool, listMcpTools } from './tools.js';

const PACKAGE_NAME = '@arguslog/mcp-server';
const PACKAGE_VERSION = '0.4.2';

async function main(): Promise<void> {
  // Build the client lazily — registry probes (Glama's introspection sandbox, Smithery's
  // listing scanner) start the binary without a PAT just to enumerate tools/list. Throwing
  // up-front would fail those checks even though the static tool catalog doesn't need a PAT.
  // Tool execution still requires the PAT and surfaces a clear error if it's missing.
  let client: ArguslogClient | null = null;
  function getClient(): ArguslogClient {
    if (!client) client = ArguslogClient.fromEnv();
    return client;
  }
  if (process.env.ARGUSLOG_PAT && process.env.ARGUSLOG_PAT.trim().length > 0) {
    process.stderr.write(`[${PACKAGE_NAME}] starting; base URL = ${process.env.ARGUSLOG_API_URL ?? 'https://api.arguslog.org'}\n`);
  } else {
    process.stderr.write(
      `[${PACKAGE_NAME}] starting WITHOUT a PAT — tool calls will fail until ARGUSLOG_PAT is set.\n`,
    );
  }

  const server = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: listMcpTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const result = await executeTool(getClient(), name, (args ?? {}) as Record<string, unknown>);
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[${PACKAGE_NAME}] ready\n`);
}

main().catch((err) => {
  process.stderr.write(
    `[${PACKAGE_NAME}] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
