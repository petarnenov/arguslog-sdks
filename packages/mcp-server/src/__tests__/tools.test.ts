import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArguslogClient } from '../client.js';
import { executeTool, listMcpTools } from '../tools.js';

describe('tool dispatch', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.ARGUSLOG_PAT = 'arglog_pat_test';
    process.env.ARGUSLOG_API_URL = 'https://api.example.com';
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.ARGUSLOG_PAT;
    delete process.env.ARGUSLOG_API_URL;
  });

  it('listMcpTools returns at least the curated tools', () => {
    const tools = listMcpTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_my_orgs');
    expect(names).toContain('list_issues');
    expect(names).toContain('grant_bonus_plan');
    // OpenAPI auto-gen contributes the rest — should be a meaningful number.
    expect(tools.length).toBeGreaterThan(20);
  });

  it('substitutes path params and removes them from the body', async () => {
    const fetchMock = vi.fn(async (_url: URL | string, _opts?: RequestInit) =>
      new Response(JSON.stringify({ id: 99 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = ArguslogClient.fromEnv();
    await executeTool(client, 'create_project', {
      orgId: 42,
      body: { name: 'Acme', platform: 'react' },
    });

    const call = fetchMock.mock.calls[0]!;
    const url = call[0] as URL;
    const opts = call[1] as RequestInit;
    expect(url.toString()).toBe('https://api.example.com/api/v1/orgs/42/projects');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe('{"name":"Acme","platform":"react"}');
  });

  it('routes query params correctly for list endpoints', async () => {
    const fetchMock = vi.fn(
      async (_url: URL | string, _opts?: RequestInit) =>
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = ArguslogClient.fromEnv();
    await executeTool(client, 'list_issues', {
      projectId: 7,
      statuses: 'unresolved',
      limit: 25,
    });

    const url = (fetchMock.mock.calls[0]![0] as URL).toString();
    expect(url).toContain('/api/v1/projects/7/issues');
    expect(url).toContain('statuses=unresolved');
    expect(url).toContain('limit=25');
  });

  it('throws when a required path param is missing', async () => {
    const client = ArguslogClient.fromEnv();
    await expect(executeTool(client, 'list_issues', {})).rejects.toThrow(/projectId/);
  });

  it('rejects unknown tool names with a clear error', async () => {
    const client = ArguslogClient.fromEnv();
    await expect(executeTool(client, 'does_not_exist', {})).rejects.toThrow(/Unknown tool/);
  });
});
