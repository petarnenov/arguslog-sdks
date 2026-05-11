import { __resetForTests, getClient, init } from '@arguslog/sdk-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArguslogErrorHandler } from '../error-handler.js';

describe('ArguslogErrorHandler', () => {
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

  it('forwards thrown errors to captureException', () => {
    const client = getClient();
    expect(client).toBeDefined();
    const spy = vi.spyOn(client!, 'captureException');

    const handler = new ArguslogErrorHandler();
    const err = new Error('boom');
    handler.handleError(err);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(err);
    expect(spy.mock.calls[0]?.[1]).toEqual({ tags: { framework: 'angular' } });
  });

  it('unwraps zone.js promise rejections (.rejection)', () => {
    const client = getClient();
    const spy = vi.spyOn(client!, 'captureException');

    const real = new Error('inner');
    const wrapped = { rejection: real, message: 'Uncaught (in promise): inner' };

    new ArguslogErrorHandler().handleError(wrapped);

    expect(spy.mock.calls[0]?.[0]).toBe(real);
  });

  it('unwraps zone.js wrappers (.originalError)', () => {
    const client = getClient();
    const spy = vi.spyOn(client!, 'captureException');

    const real = new Error('inner');
    const wrapped = { originalError: real };

    new ArguslogErrorHandler().handleError(wrapped);

    expect(spy.mock.calls[0]?.[0]).toBe(real);
  });

  it('passes through plain values when no wrapper present', () => {
    const client = getClient();
    const spy = vi.spyOn(client!, 'captureException');

    new ArguslogErrorHandler().handleError('string error');

    expect(spy.mock.calls[0]?.[0]).toBe('string error');
  });

  it('does not throw when no client is initialized', () => {
    __resetForTests();
    expect(() => new ArguslogErrorHandler().handleError(new Error('x'))).not.toThrow();
  });
});
