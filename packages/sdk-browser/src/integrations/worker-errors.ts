import type { ArguslogClient } from '@arguslog/sdk-core';

/**
 * Forwards errors from Web Workers + Service Workers into the main-thread client. Without
 * this, a thrown exception inside {@code worker.postMessage} handler or a service worker
 * fetch handler is invisible to the SDK — it never reaches {@code window.onerror} on the
 * page and silently fails.
 *
 * <p>Strategy:
 *
 * <ul>
 *   <li>Patch the global {@code Worker} constructor to add an {@code error} listener on every
 *       new worker the user code constructs. The original worker behaviour is unchanged.</li>
 *   <li>Listen on {@code navigator.serviceWorker} for {@code error} events from the active
 *       registration. Optionally, accept structured error messages from a worker that calls
 *       {@code postMessage({ __arguslog: 'error', message, stack })} — this is the
 *       reliable path because service workers can't share Error objects across the boundary.</li>
 * </ul>
 */
export function installWorkerErrorBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof window === 'undefined') return () => {};

  const uninstallers: Array<() => void> = [];

  if (typeof Worker !== 'undefined') {
    const OriginalWorker = Worker;
    function PatchedWorker(this: Worker, scriptURL: string | URL, options?: WorkerOptions): Worker {
      const w = new OriginalWorker(scriptURL, options);
      try {
        w.addEventListener('error', (event: ErrorEvent) => {
          try {
            client.addBreadcrumb({
              category: 'worker.error',
              message: event.message || 'Worker error',
              level: 'error',
              data: {
                scriptURL: typeof scriptURL === 'string' ? scriptURL : scriptURL.toString(),
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
              },
            });
          } catch {
            // best-effort
          }
        });
        w.addEventListener('messageerror', () => {
          try {
            client.addBreadcrumb({
              category: 'worker.error',
              message: 'Worker messageerror — message could not be deserialized',
              level: 'error',
            });
          } catch {
            // best-effort
          }
        });
      } catch {
        // best-effort — worker still works even if listener attach fails
      }
      return w;
    }
    PatchedWorker.prototype = OriginalWorker.prototype;
    (window as Window & { Worker: typeof Worker }).Worker =
      PatchedWorker as unknown as typeof Worker;
    uninstallers.push(() => {
      (window as Window & { Worker: typeof Worker }).Worker = OriginalWorker;
    });
  }

  // Service workers: hook the registration's error event when a registration becomes available.
  // navigator.serviceWorker exists only in secure contexts (HTTPS or localhost). On the
  // dashboard we don't ship a service worker today but a customer's app may.
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    const onSwError = (event: Event) => {
      try {
        client.addBreadcrumb({
          category: 'serviceworker.error',
          message: 'Service worker error',
          level: 'error',
          data: { type: event.type },
        });
      } catch {
        // best-effort
      }
    };
    const onSwMessage = (event: MessageEvent) => {
      // Opt-in protocol: a worker can postMessage({ __arguslog: 'error', message, stack })
      // and we'll surface it as a breadcrumb. Anything else is ignored so we don't leak the
      // user's app traffic into the breadcrumb stream.
      if (
        event.data &&
        typeof event.data === 'object' &&
        (event.data as { __arguslog?: string }).__arguslog === 'error'
      ) {
        try {
          const data = event.data as { message?: string; stack?: string; level?: string };
          client.addBreadcrumb({
            category: 'serviceworker.error',
            message: data.message || 'Service worker reported error',
            level: 'error',
            data: { stack: data.stack },
          });
        } catch {
          // best-effort
        }
      }
    };

    navigator.serviceWorker.addEventListener('error', onSwError);
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    uninstallers.push(() => {
      navigator.serviceWorker.removeEventListener('error', onSwError);
      navigator.serviceWorker.removeEventListener('message', onSwMessage);
    });
  }

  return () => {
    for (const off of uninstallers) off();
  };
}
