import type { ArguslogClient } from '@arguslog/sdk-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture each web-vitals subscriber so the test can drive synthetic metric values.
const subscribers: Array<(metric: unknown) => void> = [];

vi.mock('web-vitals', () => {
  const subscribe = (cb: (metric: unknown) => void) => {
    subscribers.push(cb);
  };
  return {
    onCLS: subscribe,
    onFCP: subscribe,
    onINP: subscribe,
    onLCP: subscribe,
    onTTFB: subscribe,
  };
});

import { installWebVitalsBreadcrumbs } from '../integrations/web-vitals.js';

function fakeClient(): ArguslogClient {
  return { addBreadcrumb: vi.fn() } as unknown as ArguslogClient;
}

describe('installWebVitalsBreadcrumbs', () => {
  beforeEach(() => {
    subscribers.length = 0;
  });

  it('subscribes to all five vitals on install', () => {
    const client = fakeClient();
    installWebVitalsBreadcrumbs(client);
    expect(subscribers).toHaveLength(5);
  });

  it('records LCP poor as warning with rounded ms', () => {
    const client = fakeClient();
    installWebVitalsBreadcrumbs(client);
    const cb = subscribers[0]!;
    cb({ name: 'LCP', value: 4123.456, rating: 'poor', navigationType: 'navigate' });
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web-vital',
        level: 'warning',
        message: 'LCP 4123ms (poor)',
        data: expect.objectContaining({ name: 'LCP', value: 4123, rating: 'poor' }),
      }),
    );
  });

  it('records CLS with three-decimal precision', () => {
    const client = fakeClient();
    installWebVitalsBreadcrumbs(client);
    const cb = subscribers[0]!;
    cb({ name: 'CLS', value: 0.234567, rating: 'needs-improvement' });
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/CLS 0\.235.*needs-improvement/),
        data: expect.objectContaining({ value: 0.235 }),
      }),
    );
  });

  it('records good rating as info level', () => {
    const client = fakeClient();
    installWebVitalsBreadcrumbs(client);
    const cb = subscribers[0]!;
    cb({ name: 'TTFB', value: 200, rating: 'good' });
    expect(client.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
  });
});
