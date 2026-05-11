import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installConsoleBreadcrumbs } from '../integrations/console-breadcrumbs.js';

function fakeClient(): ArguslogClient {
  return {
    addBreadcrumb: vi.fn(),
  } as unknown as ArguslogClient;
}

describe('installConsoleBreadcrumbs', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('records info breadcrumb on console.log', () => {
    const client = fakeClient();
    uninstall = installConsoleBreadcrumbs(client);
    console.log('hello world');
    expect(client.addBreadcrumb).toHaveBeenCalledWith({
      category: 'console',
      message: 'hello world',
      level: 'info',
      data: undefined,
    });
  });

  it('maps console.warn to level=warning', () => {
    const client = fakeClient();
    uninstall = installConsoleBreadcrumbs(client);
    console.warn('careful');
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('maps console.error to level=error', () => {
    const client = fakeClient();
    uninstall = installConsoleBreadcrumbs(client);
    console.error('bad');
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('preserves the original console call so the dev tools still print', () => {
    const client = fakeClient();
    const originalLog = console.log;
    const spy = vi.fn();
    console.log = spy;
    try {
      uninstall = installConsoleBreadcrumbs(client);
      console.log('x', 1);
      expect(spy).toHaveBeenCalledWith('x', 1);
    } finally {
      console.log = originalLog;
    }
  });

  it('captures extra args as data.extra', () => {
    const client = fakeClient();
    uninstall = installConsoleBreadcrumbs(client);
    console.error('login failed', { userId: 4 });
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'login failed',
        data: { extra: ['{"userId":4}'] },
      }),
    );
  });

  it('uninstall restores original console methods', () => {
    const client = fakeClient();
    const originalLog = console.log;
    uninstall = installConsoleBreadcrumbs(client);
    expect(console.log).not.toBe(originalLog);
    uninstall();
    uninstall = undefined;
    expect(console.log).toBe(originalLog);
  });
});
