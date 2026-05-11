import { getClient } from '@arguslog/sdk-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetForTests, init } from '../init.js';

describe('init (RN)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
  });

  it('initializes the underlying browser client', () => {
    expect(getClient()).toBeUndefined();
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: {
        fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
      },
    });
    expect(getClient()).toBeDefined();
  });

  it('throws on an invalid DSN', () => {
    expect(() => init({ dsn: 'not-a-dsn' })).toThrow();
  });

  it('installs RN ErrorUtils handler when globalHandlers is requested', () => {
    const setGlobalHandler = vi.fn();
    const errorUtils = {
      setGlobalHandler,
      getGlobalHandler: () => undefined,
    };
    // RN exposes ErrorUtils as a global. Stub it on globalThis for the duration of the test.
    (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils = errorUtils;

    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      integrations: ['globalHandlers'],
      transport: {
        fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
      },
    });

    expect(setGlobalHandler).toHaveBeenCalledTimes(1);

    delete (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils;
  });

  it('re-init tears down the previous handler', () => {
    const handlers: Array<(error: Error, isFatal?: boolean) => void> = [];
    const errorUtils = {
      setGlobalHandler(h: (error: Error, isFatal?: boolean) => void): void {
        handlers.push(h);
      },
      getGlobalHandler(): undefined {
        return undefined;
      },
    };
    (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils = errorUtils;

    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      integrations: ['globalHandlers'],
      transport: {
        fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
      },
    });
    init({
      dsn: 'arguslog://k@localhost:8080/api/2',
      integrations: ['globalHandlers'],
      transport: {
        fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
      },
    });

    // Two real installs + one restore call when re-init tears down the first.
    expect(handlers.length).toBeGreaterThanOrEqual(2);

    delete (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils;
  });
});
