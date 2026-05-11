import type { ArguslogClient } from '@arguslog/sdk-core';

/**
 * Records page visibility transitions. Distinguishes three signals:
 *
 * <ul>
 *   <li>{@code visibilitychange} — tab becomes hidden / visible. The user switching tabs is
 *       a common reason a setInterval misbehaves later, or a polling fetch returns 401 when
 *       the user comes back after a long break.</li>
 *   <li>{@code pagehide} — the user is leaving the page (back/forward, tab close, navigation
 *       away). Important context if a crash happens during cleanup.</li>
 *   <li>{@code online} / {@code offline} — connection changes. A request that fails because
 *       the user just walked into a tunnel reads very differently from a 502 from the API.</li>
 * </ul>
 */
export function installVisibilityBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const onVisibilityChange = () => {
    try {
      const state = document.visibilityState;
      client.addBreadcrumb({
        category: 'page.visibility',
        message: `tab ${state}`,
        level: 'info',
        data: { visibilityState: state },
      });
    } catch {
      // best-effort
    }
  };

  const onPageHide = (event: PageTransitionEvent) => {
    try {
      client.addBreadcrumb({
        category: 'page.lifecycle',
        message: 'pagehide',
        level: 'info',
        data: { persisted: event.persisted },
      });
    } catch {
      // best-effort
    }
  };

  const onOnline = () => {
    try {
      client.addBreadcrumb({
        category: 'connection',
        message: 'online',
        level: 'info',
      });
    } catch {
      // best-effort
    }
  };

  const onOffline = () => {
    try {
      client.addBreadcrumb({
        category: 'connection',
        message: 'offline',
        level: 'warning',
      });
    } catch {
      // best-effort
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
