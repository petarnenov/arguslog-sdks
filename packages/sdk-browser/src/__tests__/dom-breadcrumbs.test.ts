import type { ArguslogClient } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installDomBreadcrumbs } from '../integrations/dom-breadcrumbs.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

describe('installDomBreadcrumbs', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    document.body.innerHTML = '';
  });

  it('records breadcrumb when a tracked button is clicked', () => {
    const client = fakeClient();
    document.body.innerHTML = '<button id="pay" class="primary">Pay</button>';
    uninstall = installDomBreadcrumbs(client);
    document.getElementById('pay')!.click();
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'ui.click',
        level: 'info',
        message: expect.stringContaining('button'),
      }),
    );
  });

  it('walks up to a clickable ancestor when click hits inner span', () => {
    const client = fakeClient();
    document.body.innerHTML = '<button><span id="inner">Click me</span></button>';
    uninstall = installDomBreadcrumbs(client);
    document.getElementById('inner')!.click();
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('button') }),
    );
  });

  it('uses data-arguslog-label as a human-readable override', () => {
    const client = fakeClient();
    document.body.innerHTML =
      '<button data-arguslog-label="Upgrade to Pro">Upgrade <span>(save 33%)</span></button>';
    uninstall = installDomBreadcrumbs(client);
    document.querySelector('button')!.click();
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Upgrade to Pro' }),
    );
  });

  it('ignores clicks on non-interactive elements', () => {
    const client = fakeClient();
    document.body.innerHTML = '<div id="bg">background</div>';
    uninstall = installDomBreadcrumbs(client);
    document.getElementById('bg')!.click();
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('records breadcrumb on form submit', () => {
    const client = fakeClient();
    document.body.innerHTML =
      '<form id="signup" action="/signup" method="post"><input name="email" /></form>';
    uninstall = installDomBreadcrumbs(client);
    const form = document.getElementById('signup') as HTMLFormElement;
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'ui.submit',
        message: expect.stringContaining('form'),
      }),
    );
  });

  it('uninstall removes both listeners', () => {
    const client = fakeClient();
    document.body.innerHTML = '<button id="b">x</button>';
    uninstall = installDomBreadcrumbs(client);
    uninstall();
    uninstall = undefined;
    document.getElementById('b')!.click();
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
  });
});
