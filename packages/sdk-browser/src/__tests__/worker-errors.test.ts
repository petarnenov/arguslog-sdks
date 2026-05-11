import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWorkerErrorBreadcrumbs } from '../integrations/worker-errors.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

describe('installWorkerErrorBreadcrumbs', () => {
  const originalWorker = (globalThis as { Worker?: typeof Worker }).Worker;
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    if (originalWorker) {
      (globalThis as { Worker?: typeof Worker }).Worker = originalWorker;
    }
  });

  it('patches the Worker constructor and forwards error events', () => {
    // Stub a minimal Worker class so jsdom (which doesn't fully implement Workers) plays
    // nicely. Listeners attached via addEventListener get captured, and we drive them by
    // dispatchEvent.
    const listeners: Record<string, Array<(event: Event) => void>> = {};
    class StubWorker extends EventTarget {
      override addEventListener(type: string, cb: (event: Event) => void) {
        (listeners[type] ??= []).push(cb);
      }
      postMessage() {}
      terminate() {}
    }
    (globalThis as { Worker: typeof Worker }).Worker = StubWorker as unknown as typeof Worker;

    const client = fakeClient();
    uninstall = installWorkerErrorBreadcrumbs(client);
    const w = new Worker('/worker.js');
    expect(w).toBeDefined();

    // Simulate the worker throwing.
    const errorEvent = new ErrorEvent('error', {
      message: 'Worker boom',
      filename: '/worker.js',
      lineno: 5,
      colno: 12,
    });
    listeners.error?.forEach((cb) => cb(errorEvent));

    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'worker.error',
        level: 'error',
        message: 'Worker boom',
        data: expect.objectContaining({ scriptURL: '/worker.js', lineno: 5, colno: 12 }),
      }),
    );
  });

  it('uninstall restores the original Worker constructor', () => {
    class StubWorker extends EventTarget {
      override addEventListener() {}
      postMessage() {}
      terminate() {}
    }
    (globalThis as { Worker: typeof Worker }).Worker = StubWorker as unknown as typeof Worker;
    const before = Worker;
    uninstall = installWorkerErrorBreadcrumbs(fakeClient());
    expect(Worker).not.toBe(before);
    uninstall();
    uninstall = undefined;
    expect(Worker).toBe(before);
  });

  it('forwards messageerror events as a separate breadcrumb', () => {
    const listeners: Record<string, Array<(event: Event) => void>> = {};
    class StubWorker extends EventTarget {
      override addEventListener(type: string, cb: (event: Event) => void) {
        (listeners[type] ??= []).push(cb);
      }
      postMessage() {}
      terminate() {}
    }
    (globalThis as { Worker: typeof Worker }).Worker = StubWorker as unknown as typeof Worker;

    const client = fakeClient();
    uninstall = installWorkerErrorBreadcrumbs(client);
    new Worker('/worker.js');

    listeners.messageerror?.forEach((cb) => cb(new Event('messageerror')));

    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'worker.error',
        level: 'error',
        message: expect.stringContaining('messageerror'),
      }),
    );
  });

  it('accepts URL scriptURL and stringifies it for the breadcrumb', () => {
    const listeners: Record<string, Array<(event: Event) => void>> = {};
    class StubWorker extends EventTarget {
      override addEventListener(type: string, cb: (event: Event) => void) {
        (listeners[type] ??= []).push(cb);
      }
    }
    (globalThis as { Worker: typeof Worker }).Worker = StubWorker as unknown as typeof Worker;
    const client = fakeClient();
    uninstall = installWorkerErrorBreadcrumbs(client);

    new Worker(new URL('https://example.com/worker.js'));
    listeners.error?.forEach((cb) => cb(new ErrorEvent('error', { message: 'oops' })));

    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scriptURL: 'https://example.com/worker.js' }),
      }),
    );
  });

  it('falls back to a generic message when ErrorEvent.message is empty', () => {
    const listeners: Record<string, Array<(event: Event) => void>> = {};
    class StubWorker extends EventTarget {
      override addEventListener(type: string, cb: (event: Event) => void) {
        (listeners[type] ??= []).push(cb);
      }
    }
    (globalThis as { Worker: typeof Worker }).Worker = StubWorker as unknown as typeof Worker;
    const client = fakeClient();
    uninstall = installWorkerErrorBreadcrumbs(client);

    new Worker('/w.js');
    listeners.error?.forEach((cb) => cb(new ErrorEvent('error', { message: '' })));

    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Worker error' }),
    );
  });

  it('swallows addBreadcrumb throws inside the error handler (best-effort)', () => {
    const listeners: Record<string, Array<(event: Event) => void>> = {};
    class StubWorker extends EventTarget {
      override addEventListener(type: string, cb: (event: Event) => void) {
        (listeners[type] ??= []).push(cb);
      }
    }
    (globalThis as { Worker: typeof Worker }).Worker = StubWorker as unknown as typeof Worker;
    const client = {
      addBreadcrumb: vi.fn(() => {
        throw new Error('client down');
      }),
    } as unknown as ArguslogClient;
    uninstall = installWorkerErrorBreadcrumbs(client);

    new Worker('/w.js');
    // Both handlers should swallow — the outer SDK never bubbles into user code.
    expect(() => listeners.error?.forEach((cb) => cb(new ErrorEvent('error')))).not.toThrow();
    expect(() =>
      listeners.messageerror?.forEach((cb) => cb(new Event('messageerror'))),
    ).not.toThrow();
  });

  it('hooks the service-worker error event when navigator.serviceWorker exists', () => {
    const swListeners: Record<string, Array<(event: Event) => void>> = {};
    const sw = {
      addEventListener: vi.fn((type: string, cb: (event: Event) => void) => {
        (swListeners[type] ??= []).push(cb);
      }),
      removeEventListener: vi.fn(),
    };
    const originalSw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: sw,
      configurable: true,
    });

    const client = fakeClient();
    const off = installWorkerErrorBreadcrumbs(client);

    swListeners.error?.forEach((cb) => cb(new Event('error')));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'serviceworker.error' }),
    );

    // Structured message-protocol breadcrumb.
    swListeners.message?.forEach((cb) =>
      cb(
        new MessageEvent('message', {
          data: { __arguslog: 'error', message: 'sw crashed', stack: 'frame1\nframe2' },
        }),
      ),
    );
    expect(client.addBreadcrumb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: 'serviceworker.error',
        message: 'sw crashed',
        data: expect.objectContaining({ stack: 'frame1\nframe2' }),
      }),
    );

    // Non-arguslog messages are ignored (no extra breadcrumb).
    const before = (client.addBreadcrumb as ReturnType<typeof vi.fn>).mock.calls.length;
    swListeners.message?.forEach((cb) =>
      cb(new MessageEvent('message', { data: { foo: 'bar' } })),
    );
    expect((client.addBreadcrumb as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);

    off();
    expect(sw.removeEventListener).toHaveBeenCalled();

    if (originalSw) {
      Object.defineProperty(navigator, 'serviceWorker', originalSw);
    } else {
      // jsdom may not have it natively; remove our stub.
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });

  it('is a no-op when window is undefined (SSR / Node)', () => {
    const originalWindow = globalThis.window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = undefined;
    const client = fakeClient();
    const off = installWorkerErrorBreadcrumbs(client);
    off();
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
    globalThis.window = originalWindow;
  });
});
