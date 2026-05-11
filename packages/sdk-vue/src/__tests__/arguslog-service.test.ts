import { __resetForTests, getClient, init } from '@arguslog/sdk-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArguslogService } from '../arguslog-service.js';

describe('ArguslogService', () => {
  beforeEach(() => {
    __resetForTests();
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: {
        fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
      },
    });
  });

  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
  });

  it('captureException proxies to the underlying client', () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const svc = new ArguslogService();
    const err = new Error('x');
    svc.captureException(err, { tags: { route: '/checkout' } });
    expect(spy).toHaveBeenCalledWith(err, { tags: { route: '/checkout' } });
  });

  it('captureMessage proxies to the underlying client', () => {
    const spy = vi.spyOn(getClient()!, 'captureMessage');
    new ArguslogService().captureMessage('hello', 'info');
    expect(spy).toHaveBeenCalledWith('hello', 'info');
  });

  it('setUser/setTag/setContext/addBreadcrumb call through', () => {
    const client = getClient()!;
    const setUser = vi.spyOn(client, 'setUser');
    const setTag = vi.spyOn(client, 'setTag');
    const setContext = vi.spyOn(client, 'setContext');
    const addBreadcrumb = vi.spyOn(client, 'addBreadcrumb');

    const svc = new ArguslogService();
    svc.setUser({ id: 'u1' });
    svc.setTag('region', 'eu');
    svc.setContext('order', { id: 42 });
    svc.addBreadcrumb({ category: 'nav', message: '/cart', level: 'info' });

    expect(setUser).toHaveBeenCalledWith({ id: 'u1' });
    expect(setTag).toHaveBeenCalledWith('region', 'eu');
    expect(setContext).toHaveBeenCalledWith('order', { id: 42 });
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'nav',
      message: '/cart',
      level: 'info',
    });
  });

  it('isInitialized reflects client state', () => {
    expect(new ArguslogService().isInitialized()).toBe(true);
    __resetForTests();
    expect(new ArguslogService().isInitialized()).toBe(false);
  });

  it('flush returns a promise', async () => {
    await expect(new ArguslogService().flush()).resolves.toBeUndefined();
  });
});
