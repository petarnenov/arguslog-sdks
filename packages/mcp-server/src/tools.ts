/**
 * Runtime tool catalog. Merges the auto-generated OpenAPI-derived tools with the curated set,
 * preferring curated entries on name collision. Each tool is exposed to MCP as:
 *
 * <ul>
 *   <li>{@code name} — stable identifier the LLM uses when invoking the tool</li>
 *   <li>{@code description} — what / when, in human prose</li>
 *   <li>{@code inputSchema} — JSON Schema describing the args shape</li>
 * </ul>
 *
 * <p>The handler is shared: every tool dispatches through {@link executeTool}, which interprets
 * the tool's recorded {@code method} / {@code path} / {@code paramSpecs} against the
 * {@link ArguslogClient}. Adding new endpoints to the OpenAPI spec → re-run {@code pnpm generate}
 * → tools become callable, no per-tool runtime wiring.
 */
import type { ArguslogClient } from './client.js';
import { CURATED_TOOLS } from './curated-tools.js';
import { OPENAPI_TOOLS, type OpenApiTool, type OpenApiToolParam } from './generated/openapi-tools.js';

/** MCP-shaped tool definition, ready to ship in a {@code tools/list} response. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  title?: string;
}

/** Full registry — name → underlying OpenApiTool. Used by both list + call handlers. */
export const TOOL_REGISTRY: Map<string, OpenApiTool> = (() => {
  const m = new Map<string, OpenApiTool>();
  for (const t of OPENAPI_TOOLS) m.set(t.name, t);
  // Curated entries override auto-generated ones — same name wins to the curated copy so the
  // LLM gets the richer description while the dispatcher path stays identical.
  for (const [name, t] of Object.entries(CURATED_TOOLS)) m.set(name, t);
  return m;
})();

/** Render the registry as MCP tool definitions. */
export function listMcpTools(): McpToolDefinition[] {
  return Array.from(TOOL_REGISTRY.values()).map((t) => {
    const def: McpToolDefinition = {
      name: t.name,
      description: t.description,
      inputSchema: toJsonSchema(t),
    };
    // Optional fields — only present on auto-generated tools (curated tools don't carry
    // them today, but the merge respects whichever is present).
    const anyT = t as unknown as Record<string, unknown>;
    if (anyT.outputSchema && typeof anyT.outputSchema === 'object') {
      def.outputSchema = anyT.outputSchema as Record<string, unknown>;
    }
    if (anyT.annotations && typeof anyT.annotations === 'object') {
      def.annotations = anyT.annotations as Record<string, unknown>;
    }
    if (typeof anyT.title === 'string') {
      def.title = anyT.title;
    }
    return def;
  });
}

/** Execute the tool named {@code name} with {@code args}, dispatching through {@code client}. */
export async function executeTool(
  client: ArguslogClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = TOOL_REGISTRY.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  // Substitute path params into the URL template, removing them from the args before they get
  // interpreted as query params or body fields.
  const remaining = { ...args };
  let path = tool.path;
  for (const p of tool.pathParams) {
    const v = remaining[p.name];
    if (v === undefined || v === null) {
      if (p.required) throw new Error(`Missing required path parameter: ${p.name}`);
      continue;
    }
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
    delete remaining[p.name];
  }

  const query: Record<string, unknown> = {};
  for (const p of tool.queryParams) {
    if (remaining[p.name] !== undefined) {
      query[p.name] = remaining[p.name];
      delete remaining[p.name];
    }
  }

  // Anything not consumed by path / query becomes the body. Curated tools deliberately wrap
  // the body in `{ body: {...} }` so the LLM sees it explicitly.
  let body: unknown = undefined;
  if (tool.hasBody) {
    if ('body' in remaining) {
      body = remaining.body;
      delete remaining.body;
    } else if (Object.keys(remaining).length > 0) {
      body = remaining;
    }
  }

  return client.request({
    method: tool.method,
    path,
    query,
    body,
  });
}

function toJsonSchema(tool: OpenApiTool): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of tool.pathParams) {
    properties[p.name] = jsonSchemaForParam(p);
    if (p.required) required.push(p.name);
  }
  for (const p of tool.queryParams) {
    properties[p.name] = jsonSchemaForParam(p);
    if (p.required) required.push(p.name);
  }
  if (tool.hasBody) {
    properties['body'] = {
      type: 'object',
      description: 'Request body — JSON object matching the OpenAPI request schema.',
      additionalProperties: true,
    };
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function jsonSchemaForParam(p: OpenApiToolParam): Record<string, unknown> {
  switch (p.type) {
    case 'integer':
      return { type: 'integer', description: paramDescription(p) };
    case 'number':
      return { type: 'number', description: paramDescription(p) };
    case 'boolean':
      return { type: 'boolean', description: paramDescription(p) };
    case 'array':
      return { type: 'array', items: { type: 'string' }, description: paramDescription(p) };
    case 'object':
      return { type: 'object', description: paramDescription(p), additionalProperties: true };
    case 'string':
    case 'unknown':
    default:
      return { type: 'string', description: paramDescription(p) };
  }
}

function paramDescription(p: OpenApiToolParam): string {
  if (p.description && p.description.trim().length > 0) return p.description;
  return p.required ? `${p.name} — required.` : `${p.name} — optional.`;
}
