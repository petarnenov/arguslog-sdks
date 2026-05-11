import type { ArguslogClient, Level } from '@arguslog/sdk-core';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

/**
 * Records Core Web Vitals as breadcrumbs. Each metric fires once when the browser has settled
 * on a final value (LCP and CLS keep updating until the page is hidden; web-vitals's onX
 * subscribers handle the buffering for us). The {@code rating} {@code 'good' | 'needs-improvement'
 * | 'poor'} comes from the same library and maps to breadcrumb levels: good/needs → info,
 * poor → warning, so a poor LCP shows up next to a crash with a yellow strip in the timeline.
 *
 * <p>Does not start its own measurement infrastructure — relies on
 * {@code web-vitals}, a tiny library (~3KB) maintained by the Chrome perf team. Pure no-op
 * outside the browser.
 */
export function installWebVitalsBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof window === 'undefined') return () => {};

  const record = (metric: Metric) => {
    try {
      const level: Level =
        metric.rating === 'poor'
          ? 'warning'
          : metric.rating === 'needs-improvement'
            ? 'info'
            : 'info';
      client.addBreadcrumb({
        category: 'web-vital',
        message: `${metric.name} ${formatValue(metric)} (${metric.rating})`,
        level,
        data: {
          name: metric.name,
          value: roundValue(metric),
          rating: metric.rating,
          navigationType: metric.navigationType,
        },
      });
    } catch {
      // best-effort
    }
  };

  // Each subscriber is install-once-per-load — web-vitals deduplicates internally and has no
  // public unsubscribe API. The unsubscribe we return for parity with other integrations is a
  // best-effort no-op; on hot-reload the next init's record callback will fire alongside any
  // previous one, but the breadcrumbs all flow into the latest active client, so duplicates
  // would only happen if the user calls init() back-to-back inside the same metric window
  // (rare). Acceptable trade-off for a 3KB integration.
  onCLS(record);
  onFCP(record);
  onINP(record);
  onLCP(record);
  onTTFB(record);

  return () => {
    // No-op — see comment above.
  };
}

function roundValue(metric: Metric): number {
  // CLS is a unitless ratio — keep 3 decimals. Everything else is ms — round to whole.
  return metric.name === 'CLS' ? Math.round(metric.value * 1000) / 1000 : Math.round(metric.value);
}

function formatValue(metric: Metric): string {
  if (metric.name === 'CLS') return roundValue(metric).toFixed(3);
  return `${roundValue(metric)}ms`;
}
