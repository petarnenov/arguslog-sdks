import { __resetForTests, getClient, init } from '@arguslog/sdk-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wrapServerAction } from '../wrap-server-action.js';

describe('wrapServerAction', () => {
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
    const wrapped = wrapServerAction(async (n: number) => n * 2);
    expect(await wrapped(5)).toBe(10);
  });

  it('captures and re-throws genuine errors', async () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const err = new Error('action-fail');
    const wrapped = wrapServerAction(async () => {
      throw err;
    });

    await expect(wrapped()).rejects.toBe(err);
    expect(spy).toHaveBeenCalledWith(err, {
      tags: { framework: 'nextjs', route: 'server-action' },
    });
  });

  it('does NOT capture redirect() control flow errors', async () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    const wrapped = wrapServerAction(async () => {
      throw redirect;
    });

    await expect(wrapped()).rejects.toBe(redirect);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT capture notFound() control flow errors', async () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const notFound = Object.assign(new Error('NEXT_NOT_FOUND'), {
      digest: 'NEXT_NOT_FOUND',
    });
    const wrapped = wrapServerAction(async () => {
      throw notFound;
    });

    await expect(wrapped()).rejects.toBe(notFound);
    expect(spy).not.toHaveBeenCalled();
  });

  it('captures errors whose digest is not a Next sentinel', async () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const err = Object.assign(new Error('user error'), { digest: 'random-digest' });
    const wrapped = wrapServerAction(async () => {
      throw err;
    });

    await expect(wrapped()).rejects.toBe(err);
    expect(spy).toHaveBeenCalled();
  });
});
