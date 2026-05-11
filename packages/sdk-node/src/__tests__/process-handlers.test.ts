import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installProcessHandlers } from '../integrations/process-handlers.js';

function fakeClient(flushImpl: () => Promise<void> = () => Promise.resolve()): ArguslogClient {
  return {
    captureException: vi.fn(),
    flush: vi.fn(flushImpl),
  } as unknown as ArguslogClient;
}

describe('installProcessHandlers', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    vi.restoreAllMocks();
  });

  it('routes uncaughtException to captureException with fatal level', async () => {
    const client = fakeClient();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      // swallow — we don't actually want to exit the test runner
    }) as never);

    uninstall = installProcessHandlers(client, { exitOnUncaught: true, flushTimeoutMs: 50 });
    process.emit('uncaughtException', new Error('crash'));
    expect(client.captureException).toHaveBeenCalledWith(expect.any(Error), { level: 'fatal' });
    // Wait one macrotask for the flush race + exit path.
    await new Promise((r) => setTimeout(r, 80));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not call process.exit when exitOnUncaught is false', async () => {
    const client = fakeClient();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      // noop
    }) as never);

    uninstall = installProcessHandlers(client, { exitOnUncaught: false, flushTimeoutMs: 50 });
    process.emit('uncaughtException', new Error('crash'));
    await new Promise((r) => setTimeout(r, 80));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('routes unhandledRejection (Error) to captureException with error level', () => {
    const client = fakeClient();
    uninstall = installProcessHandlers(client);
    const reason = new Error('rejected');
    process.emit('unhandledRejection', reason, Promise.resolve());
    expect(client.captureException).toHaveBeenCalledWith(reason, { level: 'error' });
  });

  it('synthesizes Error for non-Error rejection reason', () => {
    const client = fakeClient();
    uninstall = installProcessHandlers(client);
    process.emit('unhandledRejection', 'plain string reason', Promise.resolve());
    const captured = (client.captureException as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('plain string reason');
  });

  it('flushes on beforeExit', () => {
    const client = fakeClient();
    uninstall = installProcessHandlers(client);
    process.emit('beforeExit', 0);
    expect(client.flush).toHaveBeenCalled();
  });

  it('uninstall removes the process listeners it installed', () => {
    const before = {
      uncaught: process.listenerCount('uncaughtException'),
      unhandled: process.listenerCount('unhandledRejection'),
      beforeExit: process.listenerCount('beforeExit'),
    };
    const u = installProcessHandlers(fakeClient());
    expect(process.listenerCount('uncaughtException')).toBe(before.uncaught + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(before.unhandled + 1);
    expect(process.listenerCount('beforeExit')).toBe(before.beforeExit + 1);
    u();
    expect(process.listenerCount('uncaughtException')).toBe(before.uncaught);
    expect(process.listenerCount('unhandledRejection')).toBe(before.unhandled);
    expect(process.listenerCount('beforeExit')).toBe(before.beforeExit);
  });

  it('flush timeout does not block process.exit when transport is hung', async () => {
    let neverResolves: ((v: void) => void) | undefined;
    const hung = new Promise<void>((r) => {
      neverResolves = r;
    });
    const client = fakeClient(() => hung);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      // noop
    }) as never);

    uninstall = installProcessHandlers(client, { exitOnUncaught: true, flushTimeoutMs: 30 });
    process.emit('uncaughtException', new Error('crash'));
    await new Promise((r) => setTimeout(r, 80));
    expect(exitSpy).toHaveBeenCalledWith(1);
    // Resolve the hung flush so the test cleans up.
    neverResolves?.();
  });
});
