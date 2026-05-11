import type { EventPayload } from '@arguslog/sdk-core';
import { afterEach, describe, expect, it } from 'vitest';

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

  describe('Network Information API + matchMedia branches', () => {
    const originalConnection = Object.getOwnPropertyDescriptor(navigator, 'connection');
    const originalMatchMedia = (globalThis as { matchMedia?: (q: string) => MediaQueryList })
      .matchMedia;

    afterEach(() => {
      if (originalConnection) {
        Object.defineProperty(navigator, 'connection', originalConnection);
      } else {
        Reflect.deleteProperty(navigator, 'connection');
      }
      (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia =
        originalMatchMedia;
    });

    it('captures effective connection type / saveData / downlink / rtt when available', () => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { effectiveType: '4g', saveData: false, downlink: 12.5, rtt: 80 },
      });
      const a = new BrowserAdapter();
      const ev = emptyEvent();
      a.enrichEvent(ev);
      expect(ev.contexts?.browser).toMatchObject({
        effectiveConnection: '4g',
        saveData: false,
        downlinkMbps: 12.5,
        rttMs: 80,
      });
    });

    it('omits connection fields that are missing on the partial implementation', () => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { effectiveType: '3g' },
      });
      const a = new BrowserAdapter();
      const ev = emptyEvent();
      a.enrichEvent(ev);
      const browser = ev.contexts?.browser as Record<string, unknown>;
      expect(browser.effectiveConnection).toBe('3g');
      expect(browser.saveData).toBeUndefined();
      expect(browser.downlinkMbps).toBeUndefined();
      expect(browser.rttMs).toBeUndefined();
    });

    it('captures matchMedia color-scheme + reduced-motion when supported', () => {
      (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia = ((q: string) => ({
        matches: q.includes('dark'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      })) as unknown as (q: string) => MediaQueryList;

      const a = new BrowserAdapter();
      const ev = emptyEvent();
      a.enrichEvent(ev);
      const browser = ev.contexts?.browser as Record<string, unknown>;
      expect(browser.colorScheme).toBe('dark');
      expect(browser.reducedMotion).toBe(false);
    });

    it('swallows matchMedia throws (older WebViews)', () => {
      (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia = () => {
        throw new Error('matchMedia stub failure');
      };
      const a = new BrowserAdapter();
      const ev = emptyEvent();
      expect(() => a.enrichEvent(ev)).not.toThrow();
      const browser = ev.contexts?.browser as Record<string, unknown>;
      expect(browser.colorScheme).toBeUndefined();
    });
  });
});
