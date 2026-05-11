import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installResourceErrorBreadcrumbs } from '../integrations/resource-errors.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

describe('installResourceErrorBreadcrumbs', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    document.body.innerHTML = '';
  });

  function dispatchResourceError(target: Element) {
    const event = new Event('error', { bubbles: false, cancelable: true });
    Object.defineProperty(event, 'target', { value: target, writable: false });
    window.dispatchEvent(event);
  }

  it('records breadcrumb when an <img> fails to load', () => {
    const client = fakeClient();
    document.body.innerHTML = '<img src="/missing.png" id="hero">';
    uninstall = installResourceErrorBreadcrumbs(client);
    dispatchResourceError(document.getElementById('hero')!);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'resource.error',
        level: 'error',
        message: expect.stringContaining('<img>'),
      }),
    );
  });

  it('records breadcrumb when a <script> fails to load', () => {
    const client = fakeClient();
    const script = document.createElement('script');
    script.src = 'https://cdn.example.com/missing.js';
    document.head.appendChild(script);
    uninstall = installResourceErrorBreadcrumbs(client);
    dispatchResourceError(script);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('cdn.example.com/missing.js'),
      }),
    );
  });

  it('ignores errors with non-resource targets', () => {
    const client = fakeClient();
    uninstall = installResourceErrorBreadcrumbs(client);
    const div = document.createElement('div');
    document.body.appendChild(div);
    dispatchResourceError(div);
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('uninstall removes the listener', () => {
    const client = fakeClient();
    document.body.innerHTML = '<img src="/x.png">';
    uninstall = installResourceErrorBreadcrumbs(client);
    uninstall();
    uninstall = undefined;
    dispatchResourceError(document.querySelector('img')!);
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
  });
});
