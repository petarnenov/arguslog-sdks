import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installLongTaskBreadcrumbs } from '../integrations/long-tasks.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

interface FakeObserver {
  callback: PerformanceObserverCallback;
  observed: PerformanceObserverInit | undefined;
  disconnect: () => void;
}

describe('installLongTaskBreadcrumbs', () => {
  const originalPO = (globalThis as { PerformanceObserver?: typeof PerformanceObserver })
    .PerformanceObserver;
  let observer: FakeObserver | undefined;

  afterEach(() => {
    if (originalPO) {
      (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver =
        originalPO;
    }
    observer = undefined;
  });

  function installFakePO() {
    function FakePerformanceObserver(this: FakeObserver, cb: PerformanceObserverCallback) {
      this.callback = cb;
      this.observed = undefined;
      this.disconnect = vi.fn();
      // Need to capture the FakePerformanceObserver instance so the outer test can fire entries through it.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      observer = this;
    }
    (FakePerformanceObserver.prototype as Record<string, unknown>).observe = function (
      this: FakeObserver,
      init: PerformanceObserverInit,
    ) {
      this.observed = init;
    };
    (FakePerformanceObserver.prototype as Record<string, unknown>).disconnect = function (
      this: FakeObserver,
    ) {
      // captured per-instance above
    };
    (
      FakePerformanceObserver as unknown as { supportedEntryTypes: readonly string[] }
    ).supportedEntryTypes = ['longtask'];
    (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver =
      FakePerformanceObserver as unknown as typeof PerformanceObserver;
  }

  function fireLongTask(durationMs: number, startMs = 0) {
    const list = {
      getEntries: () => [
        {
          duration: durationMs,
          startTime: startMs,
          name: 'self',
          entryType: 'longtask',
        } as PerformanceEntry,
      ],
    } as PerformanceObserverEntryList;
    observer!.callback(list, observer as unknown as PerformanceObserver);
  }

  it('records info breadcrumb for moderate longtask (100ms)', () => {
    installFakePO();
    const client = fakeClient();
    installLongTaskBreadcrumbs(client);
    fireLongTask(100);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'longtask',
        level: 'info',
        message: 'Main thread blocked 100ms',
      }),
    );
  });

  it('records warning for 200ms+', () => {
    installFakePO();
    const client = fakeClient();
    installLongTaskBreadcrumbs(client);
    fireLongTask(250);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('records error for 500ms+', () => {
    installFakePO();
    const client = fakeClient();
    installLongTaskBreadcrumbs(client);
    fireLongTask(800);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', message: 'Main thread blocked 800ms' }),
    );
  });

  it('no-ops in environments without PerformanceObserver', () => {
    delete (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
    const client = fakeClient();
    const off = installLongTaskBreadcrumbs(client);
    off();
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
  });
});
