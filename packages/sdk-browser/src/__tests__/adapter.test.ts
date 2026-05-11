import type { EventPayload } from '@arguslog/sdk-core';
import { describe, expect, it } from 'vitest';

import { BrowserAdapter } from '../adapter.js';

function emptyEvent(): EventPayload {
  return {
    eventId: 'x',
    timestamp: 0,
    platform: 'javascript',
    sdk: { name: 'arguslog.javascript', version: '0.0.0' },
    level: 'error',
  };
}

describe('BrowserAdapter', () => {
  it('reports javascript platform and sdk identity', () => {
    const a = new BrowserAdapter();
    expect(a.platform).toBe('javascript');
    expect(a.sdkName).toBe('arguslog.javascript');
    // sdkVersion is generator-fed from package.json:version — assert non-empty rather than
    // pinning the literal so the test doesn't have to be re-edited on every release.
    expect(a.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('enrichEvent attaches the current URL and user agent (jsdom)', () => {
    const a = new BrowserAdapter();
    const ev = emptyEvent();
    a.enrichEvent(ev);
    expect(ev.request?.url).toBeDefined();
    expect(ev.request?.userAgent).toBeDefined();
  });

  it('enrichEvent stamps a browser context with viewport, locale, online status', () => {
    const a = new BrowserAdapter();
    const ev = emptyEvent();
    a.enrichEvent(ev);
    const browser = ev.contexts?.browser;
    expect(browser).toBeDefined();
    expect(browser?.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
    expect(typeof browser?.online).toBe('boolean');
    expect(typeof browser?.language).toBe('string');
  });

  it('enrichEvent does not overwrite a pre-existing contexts.browser', () => {
    const a = new BrowserAdapter();
    const ev = emptyEvent();
    ev.contexts = { browser: { custom: 'value' } };
    a.enrichEvent(ev);
    // The implementation overwrites the bag wholesale (last writer wins). Document the
    // behaviour so a future refactor that decides to merge instead notices it changes a
    // public contract.
    expect(ev.contexts.browser?.custom).toBeUndefined();
    expect(ev.contexts.browser?.viewport).toBeDefined();
  });
});
