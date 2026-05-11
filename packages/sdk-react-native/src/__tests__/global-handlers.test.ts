import type { ArguslogClient } from '@arguslog/sdk-browser';
import { describe, expect, it, vi } from 'vitest';

import { installGlobalHandlers } from '../integrations/global-handlers.js';
import type { ErrorUtilsHandler, ErrorUtilsLike } from '../types.js';

interface FakeScope {
  ErrorUtils?: ErrorUtilsLike;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
}

function makeErrorUtils(initial?: ErrorUtilsHandler): ErrorUtilsLike & {
  fire(error: Error, isFatal?: boolean): void;
  current(): ErrorUtilsHandler | undefined;
} {
  let handler: ErrorUtilsHandler | undefined = initial;
  return {
    setGlobalHandler(next): void {
      handler = next;
    },
    getGlobalHandler(): ErrorUtilsHandler | undefined {
      return handler;
    },
    fire(error, isFatal): void {
      handler?.(error, isFatal);
    },
    current(): ErrorUtilsHandler | undefined {
      return handler;
    },
  };
}

function makeListenerScope(): FakeScope & {
  fire(type: string, event: unknown): void;
  listenerCount(type: string): number;
} {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  return {
    addEventListener(type, listener): void {
      const arr = listeners.get(type) ?? [];
      arr.push(listener);
      listeners.set(type, arr);
    },
    removeEventListener(type, listener): void {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== listener),
      );
    },
    fire(type, event): void {
      for (const l of listeners.get(type) ?? []) l(event);
    },
    listenerCount(type): number {
      return listeners.get(type)?.length ?? 0;
    },
  };
}

function makeClient(): ArguslogClient {
  return {
    captureException: vi.fn(() => 'eid'),
  } as unknown as ArguslogClient;
}

describe('installGlobalHandlers (RN)', () => {
  it('forwards ErrorUtils errors to captureException with fatal level', () => {
    const errorUtils = makeErrorUtils();
    const client = makeClient();
    const scope = { ErrorUtils: errorUtils } as FakeScope;

    installGlobalHandlers(client, scope);
    const err = new Error('boom');
    errorUtils.fire(err, true);

    expect(client.captureException).toHaveBeenCalledWith(err, {
      level: 'fatal',
      tags: { mechanism: 'ErrorUtils' },
    });
  });

  it('uses error level when isFatal is false/undefined', () => {
    const errorUtils = makeErrorUtils();
    const client = makeClient();

    installGlobalHandlers(client, { ErrorUtils: errorUtils } as FakeScope);
    errorUtils.fire(new Error('soft'));

    expect(client.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: 'error',
      tags: { mechanism: 'ErrorUtils' },
    });
  });

  it('chains the previous ErrorUtils handler', () => {
    const previous = vi.fn();
    const errorUtils = makeErrorUtils(previous);
    const client = makeClient();

    installGlobalHandlers(client, { ErrorUtils: errorUtils } as FakeScope);
    const err = new Error('chained');
    errorUtils.fire(err, false);

    expect(previous).toHaveBeenCalledWith(err, false);
  });

  it('coerces non-Error throws into Error', () => {
    const errorUtils = makeErrorUtils();
    const client = makeClient();

    installGlobalHandlers(client, { ErrorUtils: errorUtils } as FakeScope);
    errorUtils.fire('plain string' as unknown as Error);

    const arg = (client.captureException as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg).toBeInstanceOf(Error);
  });

  it('captures unhandledrejection events when addEventListener is available', () => {
    const errorUtils = makeErrorUtils();
    const listenerScope = makeListenerScope();
    const client = makeClient();
    const scope: FakeScope = { ErrorUtils: errorUtils, ...listenerScope };

    installGlobalHandlers(client, scope);
    listenerScope.fire('unhandledrejection', { reason: new Error('rej') });

    expect(client.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: 'error',
      tags: { mechanism: 'unhandledrejection' },
    });
  });

  it('teardown restores previous ErrorUtils handler and removes the listener', () => {
    const previous = vi.fn();
    const errorUtils = makeErrorUtils(previous);
    const listenerScope = makeListenerScope();
    const client = makeClient();
    const scope: FakeScope = { ErrorUtils: errorUtils, ...listenerScope };

    const teardown = installGlobalHandlers(client, scope);
    expect(errorUtils.current()).not.toBe(previous);
    expect(listenerScope.listenerCount('unhandledrejection')).toBe(1);

    teardown();
    expect(errorUtils.current()).toBe(previous);
    expect(listenerScope.listenerCount('unhandledrejection')).toBe(0);
  });

  it('no-ops gracefully when ErrorUtils is missing', () => {
    const client = makeClient();
    const teardown = installGlobalHandlers(client, {} as FakeScope);
    expect(() => teardown()).not.toThrow();
  });
});
