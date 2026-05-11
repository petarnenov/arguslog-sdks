import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installVisibilityBreadcrumbs } from '../integrations/visibility.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

describe('installVisibilityBreadcrumbs', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('records breadcrumb on visibilitychange', () => {
    const client = fakeClient();
    uninstall = installVisibilityBreadcrumbs(client);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'page.visibility',
        message: expect.stringMatching(/^tab /),
      }),
    );
  });

  it('records breadcrumb on pagehide', () => {
    const client = fakeClient();
    uninstall = installVisibilityBreadcrumbs(client);
    const event = new Event('pagehide') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'page.lifecycle',
        message: 'pagehide',
      }),
    );
  });

  it('records online breadcrumb at info level', () => {
    const client = fakeClient();
    uninstall = installVisibilityBreadcrumbs(client);
    window.dispatchEvent(new Event('online'));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'connection', message: 'online', level: 'info' }),
    );
  });

  it('records offline breadcrumb at warning level', () => {
    const client = fakeClient();
    uninstall = installVisibilityBreadcrumbs(client);
    window.dispatchEvent(new Event('offline'));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'connection', message: 'offline', level: 'warning' }),
    );
  });

  it('uninstall removes all listeners', () => {
    const client = fakeClient();
    uninstall = installVisibilityBreadcrumbs(client);
    uninstall();
    uninstall = undefined;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('swallows addBreadcrumb throws across every handler (best-effort)', () => {
    const client = {
      addBreadcrumb: vi.fn(() => {
        throw new Error('store down');
      }),
    } as unknown as ArguslogClient;
    uninstall = installVisibilityBreadcrumbs(client);

    expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();

    const pagehide = new Event('pagehide') as PageTransitionEvent;
    Object.defineProperty(pagehide, 'persisted', { value: false });
    expect(() => window.dispatchEvent(pagehide)).not.toThrow();

    expect(() => window.dispatchEvent(new Event('online'))).not.toThrow();
    expect(() => window.dispatchEvent(new Event('offline'))).not.toThrow();

    // All four handlers were invoked.
    expect(client.addBreadcrumb).toHaveBeenCalledTimes(4);
  });
});
