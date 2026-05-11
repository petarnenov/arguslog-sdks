import { __resetForTests, getClient, init } from '@arguslog/sdk-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wrapApiHandler } from '../wrap-api-handler.js';

describe('wrapApiHandler', () => {
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

  it('passes through the return value on success', async () => {
    const handler = vi.fn(async (a: number, b: number) => a + b);
    const wrapped = wrapApiHandler(handler);
    expect(await wrapped(2, 3)).toBe(5);
    expect(handler).toHaveBeenCalledWith(2, 3);
  });

  it('captures and re-throws on error', async () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const err = new Error('boom');
    const wrapped = wrapApiHandler(async () => {
      throw err;
    });

    await expect(wrapped()).rejects.toBe(err);
    expect(spy).toHaveBeenCalledWith(err, {
      tags: { framework: 'nextjs', route: 'api' },
    });
  });
});
