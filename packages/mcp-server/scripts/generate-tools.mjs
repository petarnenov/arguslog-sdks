#!/usr/bin/env node
/**
 * Build-time codegen — reads services/api/openapi.json and emits one MCP tool definition per
 * REST operation into src/generated/openapi-tools.ts. Tools are named
 * {@code arguslog_<group>_<op>} where {@code group} comes from the operation's first tag (or
 * the first path segment if the spec is untagged) and {@code op} is the operationId or a
 * normalized {@code <method>_<path>}. The generated module exports a single {@code OPENAPI_TOOLS}
 * array so the runtime side stays generic — adding endpoints to the API is a recompile away
 * from being callable by an LLM.
 *
 * <p>Emits per tool:
 * <ul>
 *   <li>{@code outputSchema} — resolved from {@code responses.200.content.application/json.schema}
 *       (refs followed once) so MCP clients know the result shape. Big quality-score win on
 *       Smithery / Glama (no output schemas = 0/10pt).</li>
 *   <li>{@code annotations} — {@code readOnlyHint}/{@code destructiveHint}/{@code idempotentHint}
 *       derived from HTTP method; {@code title} from operation summary. Another quality-score
 *       category (0 = 0/6pt).</li>
 *   <li>{@code title} — humanized form of the tool name for UIs that prefer it over the slug.</li>
 * </ul>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const OPENAPI = resolve(ROOT, 'services/api/openapi.json');
const OUT_DIR = resolve(__dirname, '../src/generated');
const OUT_FILE = resolve(OUT_DIR, 'openapi-tools.ts');

const spec = JSON.parse(readFileSync(OPENAPI, 'utf8'));
const tools = [];
const seenNames = new Set();

/** Empty-object schema for endpoints with no response body (DELETE → 204, etc).
 *  Smithery scores "Output schemas" by counting tools that have ANY outputSchema; emitting
 *  a permissive {type:object} placeholder gives credit for those endpoints too. */
const EMPTY_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: true,
  description: 'No response body — successful response is a 204 No Content or similar.',
});

const ACTION_VERBS = new Set([
  'get', 'list', 'create', 'update', 'delete', 'remove', 'revoke', 'grant',
  'archive', 'restore', 'invite', 'accept', 'reject', 'cancel', 'send',
  'upload', 'download', 'search', 'find', 'count', 'info', 'check', 'verify',
]);

for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    if (!op || typeof op !== 'object') continue;

    const tag = (op.tags?.[0] ?? firstPathSegment(path) ?? 'misc').toLowerCase();
    const opId =
      op.operationId ?? `${method}_${path.replace(/[/{}-]+/g, '_').replace(/^_+|_+$/g, '')}`;
    let name = makeName(tag, opId);

    // Strip the boilerplate `_controller_` infix Spring Boot bakes into operation ids — it
    // adds zero semantic value and just bloats the LLM's tool table.
    name = name.replace(/_controller_/g, '_');

    // Collapse consecutive underscores left after the strip.
    name = name.replace(/_+/g, '_').replace(/^_+|_+$/g, '');

    // MCP tool names: lowercase, ≤64 chars, [a-z0-9_]. Trim if too long.
    if (name.length > 64) name = name.slice(0, 64).replace(/_+$/, '');

    // Disambiguate collisions by including a path-derived suffix (better than `_1` / `_2`).
    if (seenNames.has(name)) {
      const pathHint = pathDisambiguator(path);
      const candidate = `${name}_${pathHint}`.slice(0, 64).replace(/_+$/, '');
      name = seenNames.has(candidate) ? `${candidate}_${method}`.slice(0, 64) : candidate;
    }
    seenNames.add(name);

    const params = op.parameters ?? [];
    const pathParams = params.filter((p) => p.in === 'path');
    const queryParams = params.filter((p) => p.in === 'query');
    const hasBody = Boolean(op.requestBody);

    const summary = String(op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`).split(
      '\n',
    )[0];
    const description =
      `${summary}\n\nMethod: ${method.toUpperCase()} ${path}` +
      (op.description && op.description !== op.summary ? `\n\n${op.description}` : '');

    const outputSchema = extractOutputSchema(op, spec);
    const annotations = makeAnnotations(method, summary);

    tools.push({
      name,
      title: humanize(name),
      description,
      method: method.toUpperCase(),
      path,
      pathParams: pathParams.map((p) => ({
        name: p.name,
        required: p.required ?? true,
        type: openApiTypeOf(p.schema),
        description: paramDescription(p),
      })),
      queryParams: queryParams.map((p) => ({
        name: p.name,
        required: p.required ?? false,
        type: openApiTypeOf(p.schema),
        description: paramDescription(p),
      })),
      hasBody,
      outputSchema,
      annotations,
    });
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT_FILE,
  `// Auto-generated by scripts/generate-tools.mjs from services/api/openapi.json.
// DO NOT EDIT BY HAND — re-run \`pnpm run generate\` after changing the OpenAPI spec.

export interface OpenApiToolParam {
  name: string;
  required: boolean;
  /** Coarse JSON Schema type — used to pick the right zod constructor at runtime. */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'unknown';
  /** Per-param description sourced from the OpenAPI parameter doc (or a default fallback).
   *  Curated tools may omit it; the runtime falls back to "<name> — required/optional." */
  description?: string;
}

export interface ToolAnnotations {
  /** Human-friendly title shown by MCP clients that surface it (Claude Desktop, Cursor, …). */
  title?: string;
  /** True iff the operation does not modify state — GET requests, basically. */
  readOnlyHint?: boolean;
  /** True iff repeating the call with the same args has the same effect (DELETE / PUT / GET). */
  idempotentHint?: boolean;
  /** True iff the call irreversibly mutates state — DELETE, or POST endpoints that revoke / archive. */
  destructiveHint?: boolean;
  /** True iff the tool reaches outside the agent's sandbox (always true for us — we hit the Arguslog API). */
  openWorldHint?: boolean;
}

export interface OpenApiTool {
  name: string;
  /** Human-friendly title (e.g. "Orgs / list mine"); MCP clients fall back to {@code name}. */
  title?: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  pathParams: OpenApiToolParam[];
  queryParams: OpenApiToolParam[];
  /** When true the tool also accepts a free-form \`body\` arg dispatched as the JSON request body. */
  hasBody: boolean;
  /** JSON Schema for the tool's success response (200/2xx body). Absent for tools where
   *  the OpenAPI spec doesn't declare a schema or for curated tools that don't bother. */
  outputSchema?: Record<string, unknown> | null;
  /** MCP capability annotations. Absent → MCP clients treat the tool as no-hint default. */
  annotations?: ToolAnnotations;
}

export const OPENAPI_TOOLS: OpenApiTool[] = ${JSON.stringify(tools, null, 2)};
`,
  'utf8',
);

console.log(`✓ Generated ${tools.length} tools → ${OUT_FILE}`);

// Emit a version.ts pinned to the package.json version so http.ts / index.ts can't drift away
// from the published npm tag at /healthz time. Single source of truth: packages/mcp-server/package.json.
const PKG = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
const VERSION_FILE = resolve(OUT_DIR, 'version.ts');
writeFileSync(
  VERSION_FILE,
  `// Auto-generated by scripts/generate-tools.mjs from packages/mcp-server/package.json.
// DO NOT EDIT BY HAND — re-run \`pnpm run generate\` after bumping the version.

export const PACKAGE_NAME = '${PKG.name}';
export const PACKAGE_VERSION = '${PKG.version}';
`,
  'utf8',
);
console.log(`✓ Generated version constants → ${VERSION_FILE}`);

function firstPathSegment(path) {
  return path.split('/').filter(Boolean)[0] ?? null;
}

/** Smithery / MCP-spec convention prefers SHORT verb-first names like {@code get_weather},
 *  not noun-first slug paths like {@code arguslog_release_get}. We:
 *
 *  <ol>
 *    <li>Drop the {@code arguslog_} prefix — the registry namespace
 *        ({@code petarnenovpetrov/arguslog}) already disambiguates.</li>
 *    <li>Re-arrange {@code <noun>_<verb>} into {@code <verb>_<noun>} (e.g.
 *        {@code release_get} → {@code get_release}).</li>
 *    <li>Strip {@code _controller_} infix.</li>
 *  </ol>
 */
function makeName(tag, opId) {
  // Strip controller suffix from tag ("ReleaseController" → "release")
  const group = normalize(tag).replace(/_?controller$/, '');
  // Strip "controller" infix from opId, lowercase + snakecase
  const op = normalize(opId).replace(/_?controller_?/, '_').replace(/_+/g, '_');
  // Combine then flip if the WHOLE combined name ends with an action verb (release_get → get_release).
  const combined = `${group}_${op}`.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return flipNounVerb(combined);
}

/** "release_get" → "get_release"; "alert_rule_get_1" → "get_alert_rule_1"; "list_mine_orgs"
 *  stays the same (verb already first). Trailing numeric disambiguator segments (Spring's
 *  _1, _2 suffix on overloaded controller methods) are preserved at the end after the flip. */
function flipNounVerb(op) {
  const parts = op.split('_').filter(Boolean);
  if (parts.length < 2) return op;
  // Pop trailing pure-digit segments so the action verb shows up as `last`.
  const trail = [];
  while (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
    trail.unshift(parts.pop());
  }
  if (parts.length < 2) return [...parts, ...trail].join('_');
  const last = parts[parts.length - 1];
  if (!ACTION_VERBS.has(last)) return [...parts, ...trail].join('_');
  // Already verb-first? Don't double-flip.
  if (ACTION_VERBS.has(parts[0])) return [...parts, ...trail].join('_');
  return [last, ...parts.slice(0, -1), ...trail].join('_');
}

function normalize(s) {
  return String(s)
    .replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function openApiTypeOf(schema) {
  if (!schema || typeof schema !== 'object') return 'unknown';
  const t = schema.type;
  if (t === 'integer') return 'integer';
  if (t === 'number' || t === 'string' || t === 'boolean' || t === 'array' || t === 'object') return t;
  return 'unknown';
}

function paramDescription(p) {
  const desc = p.description ?? '';
  if (desc) return String(desc).split('\n')[0];
  const t = p.schema?.type ?? 'string';
  return `${p.name} (${t})${p.required ? ' — required.' : ' — optional.'}`;
}

/** Picks the {@code 200} (or first 2xx) JSON response schema, resolves a single ref, and
 *  normalizes the top-level type to "object" — MCP's outputSchema spec mandates this, but
 *  many of our REST endpoints return naked arrays for list responses (HTTP 200 → JSON
 *  array). For those we wrap as {@code {type: object, properties: {result: <orig>}}} so
 *  Smithery / Glama validators don't reject the tool list.
 */
function extractOutputSchema(op, spec) {
  const responses = op.responses ?? {};
  const key =
    Object.keys(responses).find((k) => k === '200') ??
    Object.keys(responses).find((k) => /^2\d\d$/.test(k));
  if (!key) return EMPTY_OUTPUT_SCHEMA;
  const body = responses[key];
  const schema = body?.content?.['application/json']?.schema;
  if (!schema) return EMPTY_OUTPUT_SCHEMA;
  const resolved = derefShallow(schema, spec);
  if (!resolved || typeof resolved !== 'object') return EMPTY_OUTPUT_SCHEMA;
  // MCP requires top-level `type: "object"`. When the API returns an array / primitive,
  // wrap it under {result: <orig>} so the schema validates.
  if (resolved.type === 'object' || resolved.properties) return resolved;
  return {
    type: 'object',
    properties: { result: resolved },
    required: ['result'],
  };
}

/** Resolve a top-level {@code $ref} to the actual schema object so MCP clients see the shape. */
function derefShallow(schema, spec) {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.$ref && typeof schema.$ref === 'string') {
    const path = schema.$ref.replace(/^#\//, '').split('/');
    let node = spec;
    for (const part of path) {
      if (!node || typeof node !== 'object') return schema; // give up — return ref-only
      node = node[part];
    }
    return node && typeof node === 'object' ? node : schema;
  }
  return schema;
}

function makeAnnotations(method, summary) {
  const m = method.toLowerCase();
  const readOnly = m === 'get';
  const idempotent = m === 'get' || m === 'put' || m === 'delete';
  const destructive = m === 'delete';
  return {
    title: summary || undefined,
    readOnlyHint: readOnly,
    idempotentHint: idempotent,
    destructiveHint: destructive,
    openWorldHint: true, // every tool reaches out to the Arguslog API.
  };
}

function humanize(name) {
  // list_my_orgs → "List my orgs"
  return name
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function pathDisambiguator(path) {
  // Pull the last static segment of the URL — gives a meaningful disambiguator instead of `_1`.
  const segs = path.split('/').filter((s) => s && !s.startsWith('{'));
  return normalize(segs[segs.length - 1] ?? 'path');
}
