import type { EventPayload } from '@arguslog/sdk-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetForTests,
  addBreadcrumb,
  captureException,
  captureMessage,
  flush,
  getClient,
  init,
  setContext,
  setTag,
  setUser,
} from '../index.js';

describe('sdk-node public API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sent: EventPayload[];

  beforeEach(() => {
    sent = [];
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(init?.body as string) as EventPayload);
      return new Response(null, { status: 202 });
    });
  });

  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
  });

  it('init returns a client and getClient exposes it', () => {
    const c = init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
    });
    expect(getClient()).toBe(c);
  });

  it('captureException stamps platform=node and sdk.name=arguslog.node', async () => {
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
    });
    captureException(new Error('boom'));
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.platform).toBe('node');
    expect(sent[0]?.sdk.name).toBe('arguslog.node');
    expect(sent[0]?.exception?.values[0]?.value).toBe('boom');
    expect(sent[0]?.contexts?.runtime).toMatchObject({ name: 'node' });
  });

  it('captureMessage with level', async () => {
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
    });
    captureMessage('hello', 'warning');
    await flush();
    expect(sent[0]?.message).toBe('hello');
    expect(sent[0]?.level).toBe('warning');
  });

  it('scope helpers (setUser/setTag/setContext/addBreadcrumb) attach data to the next event', async () => {
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
    });
    setUser({ id: 'u1' });
    setTag('region', 'eu');
    setContext('session', { id: 's1' });
    addBreadcrumb({ category: 'job', message: 'started', level: 'info' });
    captureMessage('m');
    await flush();
    expect(sent[0]?.user?.id).toBe('u1');
    expect(sent[0]?.tags?.region).toBe('eu');
    expect(sent[0]?.contexts?.session).toEqual({ id: 's1' });
    expect(sent[0]?.breadcrumbs?.[0]?.message).toBe('started');
  });

  it('public API is a no-op before init', async () => {
    expect(getClient()).toBeUndefined();
    expect(captureException(new Error('x'))).toBeUndefined();
    expect(captureMessage('m')).toBeUndefined();
    setUser({ id: 'noop' });
    setTag('k', 'v');
    setContext('c', {});
    addBreadcrumb({ category: 'x', message: 'y', level: 'info' });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('integrations: ["processHandlers"] installs and __resetForTests uninstalls', () => {
    const before = process.listenerCount('uncaughtException');
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
      integrations: ['processHandlers'],
    });
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);
    __resetForTests();
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });

  it('re-init uninstalls previous process handlers (no leak across hot-reload)', () => {
    const before = process.listenerCount('uncaughtException');
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
      integrations: ['processHandlers'],
    });
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
      integrations: ['processHandlers'],
    });
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);
  });
});
