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
});
