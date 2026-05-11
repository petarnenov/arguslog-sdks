import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installXhrBreadcrumbs } from '../integrations/xhr-breadcrumbs.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

describe('installXhrBreadcrumbs', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it('records breadcrumb after the request completes (loadend)', () => {
    const client = fakeClient();
    uninstall = installXhrBreadcrumbs(client);

    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/things');
    xhr.send();
    // Simulate a completed XHR — jsdom doesn't actually hit the network.
    Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
    xhr.dispatchEvent(new Event('loadend'));

    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'xhr',
        level: 'info',
        message: 'GET /api/things → 200',
      }),
    );
  });

  it('marks 5xx as error level', () => {
    const client = fakeClient();
    uninstall = installXhrBreadcrumbs(client);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/x');
    xhr.send();
    Object.defineProperty(xhr, 'status', { value: 503, configurable: true });
    xhr.dispatchEvent(new Event('loadend'));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', message: 'POST /api/x → 503' }),
    );
  });

  it('uninstall restores XMLHttpRequest.prototype.open', () => {
    const client = fakeClient();
    const before = XMLHttpRequest.prototype.open;
    uninstall = installXhrBreadcrumbs(client);
    expect(XMLHttpRequest.prototype.open).not.toBe(before);
    uninstall();
    uninstall = undefined;
    expect(XMLHttpRequest.prototype.open).toBe(before);
  });
});
