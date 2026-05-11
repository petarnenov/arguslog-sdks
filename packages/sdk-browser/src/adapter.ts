import type { EventPayload, PlatformAdapter } from '@arguslog/sdk-core';

import { SDK_VERSION } from './version.generated.js';

export class BrowserAdapter implements PlatformAdapter {
  readonly sdkName = 'arguslog.javascript';
  readonly sdkVersion = SDK_VERSION;
  readonly platform = 'javascript' as const;

  enrichEvent(event: EventPayload): void {
    if (typeof window === 'undefined' || !window.location) return;

    event.request = {
      url: window.location.href,
      userAgent: window.navigator?.userAgent,
    };

    // Auto-context — runs unconditionally on every event so the dashboard always has the
    // "what was the user's setup" picture for triage. Every field is non-PII and available
    // without a permission prompt; absent fields are simply omitted (e.g. the Network
    // Information API exists only on Chromium). Sentry stamps a similar bag.
    const browser = collectBrowserContext();
    if (browser) {
      event.contexts = event.contexts ?? {};
      event.contexts.browser = browser;
    }
  }
}

function collectBrowserContext(): Record<string, unknown> | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const ctx: Record<string, unknown> = {};

  if (typeof window !== 'undefined') {
    ctx.viewport = { width: window.innerWidth, height: window.innerHeight };
    if (typeof window.devicePixelRatio === 'number') {
      ctx.devicePixelRatio = window.devicePixelRatio;
    }
  }

  if (typeof navigator.onLine === 'boolean') ctx.online = navigator.onLine;
  if (navigator.language) ctx.language = navigator.language;
  if (navigator.languages?.length) ctx.languages = Array.from(navigator.languages);
  if (typeof navigator.cookieEnabled === 'boolean') ctx.cookieEnabled = navigator.cookieEnabled;

  // Effective connection type comes from the Network Information API (Chrome/Edge/Android).
  // Absent in Safari/Firefox; we omit when unavailable rather than fabricating.
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection) {
    if (connection.effectiveType) ctx.effectiveConnection = connection.effectiveType;
    if (typeof connection.saveData === 'boolean') ctx.saveData = connection.saveData;
    if (typeof connection.downlink === 'number') ctx.downlinkMbps = connection.downlink;
    if (typeof connection.rtt === 'number') ctx.rttMs = connection.rtt;
  }

  try {
    ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Intl missing in some bundles
  }

  if (typeof matchMedia === 'function') {
    try {
      ctx.colorScheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      ctx.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      // matchMedia can throw in older WebViews
    }
  }

  return Object.keys(ctx).length > 0 ? ctx : undefined;
}

interface NetworkInformation {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  saveData?: boolean;
  downlink?: number;
  rtt?: number;
}
