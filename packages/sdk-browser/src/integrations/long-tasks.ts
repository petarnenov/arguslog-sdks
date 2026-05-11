import type { ArguslogClient } from '@arguslog/sdk-core';

/**
 * Records a breadcrumb whenever the main thread is blocked for >50ms — the
 * {@code longtask} entry type from the Performance Observer API. Reveals UI
 * freeze patterns: a heavy synchronous work loop right before a click stops
 * responding, a JSON.parse on a giant payload that stalls the next animation
 * frame, etc.
 *
 * <p>Levels: 50–200ms → info, 200–500ms → warning, 500ms+ → error. Anything
 * over half a second is "the user definitely felt that". Source attribution
 * (containerType / containerSrc) is stamped into {@code data} when the browser
 * supplies it — Chromium populates this for cross-origin scripts so a janky
 * third-party widget is identifiable.
 */
export function installLongTaskBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => {};
  }
  // Some browsers (Firefox at the time of writing) don't support the longtask entry type.
  // PerformanceObserver.supportedEntryTypes lets us bail without throwing on observe().
  const supported = (PerformanceObserver as { supportedEntryTypes?: readonly string[] })
    .supportedEntryTypes;
  if (supported && !supported.includes('longtask')) return () => {};

  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        try {
          const duration = Math.round(entry.duration);
          const level = duration >= 500 ? 'error' : duration >= 200 ? 'warning' : 'info';
          const sources = (entry as PerformanceLongTaskTiming).attribution?.[0];
          client.addBreadcrumb({
            category: 'longtask',
            message: `Main thread blocked ${duration}ms`,
            level,
            data: {
              durationMs: duration,
              startTimeMs: Math.round(entry.startTime),
              containerType: sources?.containerType,
              containerSrc: sources?.containerSrc || undefined,
              containerName: sources?.containerName || undefined,
            },
          });
        } catch {
          // best-effort
        }
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    return () => {};
  }

  return () => {
    observer?.disconnect();
  };
}

interface PerformanceLongTaskTiming extends PerformanceEntry {
  attribution?: Array<{
    containerType?: string;
    containerSrc?: string;
    containerName?: string;
  }>;
}
