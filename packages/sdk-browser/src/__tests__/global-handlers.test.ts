import type { ArguslogClient } from '@arguslog/sdk-core';
import { describe, expect, it, vi } from 'vitest';

import { installGlobalHandlers } from '../integrations/global-handlers.js';

function fakeClient(): ArguslogClient {
  return {
    captureException: vi.fn(),
  } as unknown as ArguslogClient;
}

describe('installGlobalHandlers', () => {
  it('forwards window error events to captureException', () => {
    const client = fakeClient();
    const uninstall = installGlobalHandlers(client);
    const err = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'boom' }));
    expect(client.captureException).toHaveBeenCalledWith(err, { level: 'error' });
    uninstall();
  });

  it('falls back to a synthesized Error when ErrorEvent lacks an error object', () => {
    const client = fakeClient();
    const uninstall = installGlobalHandlers(client);
    window.dispatchEvent(new ErrorEvent('error', { message: 'cross-origin script error' }));
    expect(client.captureException).toHaveBeenCalledTimes(1);
    const captured = (client.captureException as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('cross-origin script error');
    uninstall();
  });

  it('forwards unhandled promise rejections', () => {
    const client = fakeClient();
    const uninstall = installGlobalHandlers(client);
    const reason = new Error('rejected');
    // jsdom doesn't ship PromiseRejectionEvent; build one via Event + property assignment.
    const ev = new Event('unhandledrejection') as Event & { reason: unknown };
    ev.reason = reason;
    window.dispatchEvent(ev);
    expect(client.captureException).toHaveBeenCalledWith(reason, { level: 'error' });
    uninstall();
  });

  it('synthesizes an Error for non-Error rejection reasons', () => {
    const client = fakeClient();
    const uninstall = installGlobalHandlers(client);
    const ev = new Event('unhandledrejection') as Event & { reason: unknown };
    ev.reason = 'string reason';
    window.dispatchEvent(ev);
    const captured = (client.captureException as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('string reason');
    uninstall();
  });

  it('uninstall stops further events from being captured', () => {
    const client = fakeClient();
    const uninstall = installGlobalHandlers(client);
    uninstall();
    const ev = new Event('unhandledrejection') as Event & { reason: unknown };
    ev.reason = new Error('x');
    window.dispatchEvent(ev);
    expect(client.captureException).not.toHaveBeenCalled();
  });
});
