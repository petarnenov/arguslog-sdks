import type { ArguslogClient } from '@arguslog/sdk-core';

/**
 * Global handler integration: forwards errors that escape user code to the SDK so they don't
 * silently disappear in the browser console.
 *
 * <ul>
 *   <li>{@code window.onerror} — synchronous throws, async setTimeout/setInterval errors, image
 *       decode failures, etc.</li>
 *   <li>{@code window.onunhandledrejection} — Promise rejections without a {@code .catch}.</li>
 * </ul>
 *
 * Returns an unbinder for tests/teardown. The init flow doesn't currently call it; an SDK reset
 * (e.g. between unit tests) re-installs handlers idempotently because {@code addEventListener}
 * de-dupes by the same handler reference.
 */
export function installGlobalHandlers(client: ArguslogClient): () => void {
  if (typeof window === 'undefined') {
    // Jest/SSR — nothing to install.
    return () => {};
  }

  const onError = (event: ErrorEvent): void => {
    // Prefer the unwrapped Error object (carries a stack); fall back to the message string for
    // browsers / edge cases that don't supply one (e.g. cross-origin "Script error.").
    const err =
      event.error instanceof Error ? event.error : new Error(event.message || 'Unknown error');
    client.captureException(err, { level: 'error' });
  };

  const onUnhandled = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    const err =
      reason instanceof Error
        ? reason
        : new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection');
    client.captureException(err, { level: 'error' });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandled);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandled);
  };
}
