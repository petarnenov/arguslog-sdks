import type { ArguslogClient } from '@arguslog/sdk-core';

/**
 * Records a breadcrumb whenever the page's URL changes via React Router / push state /
 * back button / hash anchor click. Patches {@code history.pushState} + {@code replaceState}
 * (which don't fire popstate by spec) and listens for {@code popstate} + {@code hashchange}.
 *
 * <p>Each breadcrumb captures the from/to path so the dashboard timeline reads as a navigation
 * trail. Query strings are kept for context — the scrubber layer is responsible for redacting
 * tokens from URLs if needed.
 */
export function installHistoryBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return () => {};

  let lastUrl = currentUrl();

  function record(kind: 'push' | 'replace' | 'pop' | 'hash', from: string, to: string) {
    if (from === to) return;
    try {
      client.addBreadcrumb({
        category: 'navigation',
        message: `${from} → ${to}`,
        level: 'info',
        data: { from, to, kind },
      });
    } catch {
      // best-effort
    }
  }

  // Keep the function references unbound — uninstall must hand the same object back to the
  // history methods, otherwise hot-reload patches stack and the originals are permanently lost.
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function patchedPushState(...args: Parameters<typeof history.pushState>) {
    const before = lastUrl;
    const result = Reflect.apply(originalPushState, history, args);
    const after = currentUrl();
    lastUrl = after;
    record('push', before, after);
    return result;
  };

  history.replaceState = function patchedReplaceState(
    ...args: Parameters<typeof history.replaceState>
  ) {
    const before = lastUrl;
    const result = Reflect.apply(originalReplaceState, history, args);
    const after = currentUrl();
    lastUrl = after;
    record('replace', before, after);
    return result;
  };

  const onPopState = () => {
    const before = lastUrl;
    const after = currentUrl();
    lastUrl = after;
    record('pop', before, after);
  };
  const onHashChange = () => {
    const before = lastUrl;
    const after = currentUrl();
    lastUrl = after;
    record('hash', before, after);
  };
  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('hashchange', onHashChange);
  };
}

function currentUrl(): string {
  // Path + search + hash — the bits a frontend router actually navigates between. Keep it
  // origin-relative to avoid leaking the LAN/dev IP into events. Empty in jsdom without a real
  // location.
  if (typeof window === 'undefined' || !window.location) return '';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
