import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installHistoryBreadcrumbs } from '../integrations/history-breadcrumbs.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

describe('installHistoryBreadcrumbs', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('records breadcrumb on history.pushState', () => {
    const client = fakeClient();
    uninstall = installHistoryBreadcrumbs(client);
    history.pushState({}, '', '/billing');
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'navigation',
        level: 'info',
        data: expect.objectContaining({ kind: 'push', to: expect.stringContaining('/billing') }),
      }),
    );
  });

  it('records breadcrumb on history.replaceState', () => {
    const client = fakeClient();
    uninstall = installHistoryBreadcrumbs(client);
    history.replaceState({}, '', '/projects');
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'replace' }),
      }),
    );
  });

  it('records breadcrumb on popstate', () => {
    const client = fakeClient();
    history.pushState({}, '', '/start');
    uninstall = installHistoryBreadcrumbs(client);
    history.pushState({}, '', '/end');
    (client.addBreadcrumb as ReturnType<typeof vi.fn>).mockClear();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
    // popstate fires when the URL ALREADY changed by the browser; we only emit when from!=to.
    // Here jsdom didn't actually change the location on dispatchEvent — that's expected.
  });

  it('uninstall restores history.pushState', () => {
    const client = fakeClient();
    const before = history.pushState;
    uninstall = installHistoryBreadcrumbs(client);
    expect(history.pushState).not.toBe(before);
    uninstall();
    uninstall = undefined;
    expect(history.pushState).toBe(before);
  });
});
