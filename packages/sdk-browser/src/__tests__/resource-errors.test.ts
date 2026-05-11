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

  it('records the href for a <link> stylesheet load failure', () => {
    const client = fakeClient();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.example.com/missing.css';
    document.head.appendChild(link);
    uninstall = installResourceErrorBreadcrumbs(client);
    dispatchResourceError(link);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('cdn.example.com/missing.css'),
        data: expect.objectContaining({ tag: 'link' }),
      }),
    );
  });

  it.each([
    ['audio', 'HTMLAudioElement'],
    ['video', 'HTMLVideoElement'],
    ['source', 'HTMLSourceElement'],
    ['iframe', 'HTMLIFrameElement'],
  ])('records the .src on <%s> failures', (tag) => {
    const client = fakeClient();
    const el = document.createElement(tag) as HTMLMediaElement & { src: string };
    el.src = `https://cdn.example.com/${tag}.bin`;
    document.body.appendChild(el);
    uninstall = installResourceErrorBreadcrumbs(client);
    dispatchResourceError(el);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(`cdn.example.com/${tag}.bin`),
      }),
    );
  });

  it('falls back to the src/href attribute for tags without a typed property (object/embed)', () => {
    const client = fakeClient();
    const obj = document.createElement('object');
    obj.setAttribute('data', '/plugin.swf');
    // EMBED uses src, OBJECT uses data. The fallback path covers both since they go through
    // getAttribute('src')||getAttribute('href') — neither is set on object so the url is empty.
    document.body.appendChild(obj);
    uninstall = installResourceErrorBreadcrumbs(client);
    dispatchResourceError(obj);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '<object> failed to load',
        data: expect.objectContaining({ tag: 'object', url: undefined }),
      }),
    );
  });

  it('captures id + className metadata when present', () => {
    const client = fakeClient();
    const img = document.createElement('img');
    img.id = 'hero';
    img.className = 'banner primary';
    document.body.appendChild(img);
    uninstall = installResourceErrorBreadcrumbs(client);
    dispatchResourceError(img);
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: 'hero', className: 'banner primary' }),
      }),
    );
  });

  it('swallows addBreadcrumb throws (best-effort)', () => {
    const client = {
      addBreadcrumb: vi.fn(() => {
        throw new Error('store down');
      }),
    } as unknown as ArguslogClient;
    document.body.innerHTML = '<img src="/x.png">';
    uninstall = installResourceErrorBreadcrumbs(client);
    expect(() => dispatchResourceError(document.querySelector('img')!)).not.toThrow();
  });

  it('ignores errors whose target is not an Element at all', () => {
    const client = fakeClient();
    uninstall = installResourceErrorBreadcrumbs(client);
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: { tagName: 'IMG' }, writable: false });
    window.dispatchEvent(event);
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
  });
});
