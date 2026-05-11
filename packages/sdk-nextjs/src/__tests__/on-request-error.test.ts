import { __resetForTests, getClient, init } from '@arguslog/sdk-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onRequestError } from '../on-request-error.js';

describe('onRequestError', () => {
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

  it('forwards to captureException with router/route/method tags (App Router)', () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const err = new Error('boom');
    onRequestError(
      err,
      { path: '/api/orders', method: 'POST', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/api/orders',
        routeType: 'route',
      },
    );

    expect(spy).toHaveBeenCalledWith(err, {
      tags: {
        framework: 'nextjs',
        'next.router': 'app',
        'next.route': '/api/orders',
        'next.routeType': 'route',
        'http.method': 'POST',
      },
    });
  });

  it('maps Pages Router context to next.router=pages', () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    onRequestError(
      new Error('x'),
      { path: '/posts/[id]', method: 'GET', headers: {} },
      {
        routerKind: 'Pages Router',
        routePath: '/posts/[id]',
        routeType: 'render',
      },
    );

    const callTags = spy.mock.calls[0]?.[1]?.tags;
    expect(callTags?.['next.router']).toBe('pages');
  });
});
