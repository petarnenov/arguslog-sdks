import { __resetForTests, getClient, init } from '@arguslog/sdk-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wrapRouteHandler } from '../wrap-route-handler.js';

describe('wrapRouteHandler', () => {
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

  it('passes through Response on success', async () => {
    const wrapped = wrapRouteHandler(async () => new Response('ok', { status: 200 }));
    const res = await wrapped();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('captures and re-throws on error with route=app tag', async () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const err = new Error('rh-fail');
    const wrapped = wrapRouteHandler(async () => {
      throw err;
    });

    await expect(wrapped()).rejects.toBe(err);
    expect(spy).toHaveBeenCalledWith(err, {
      tags: { framework: 'nextjs', route: 'app' },
    });
  });
});
