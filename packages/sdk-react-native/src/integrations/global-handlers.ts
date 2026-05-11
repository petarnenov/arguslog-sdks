import type { ArguslogClient } from '@arguslog/sdk-browser';

import type { ErrorUtilsHandler, ErrorUtilsLike } from '../types.js';

interface RnGlobalLike {
  ErrorUtils?: ErrorUtilsLike;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
  HermesInternal?: unknown;
}

/**
 * RN equivalent of the browser globalHandlers integration. Wires:
 * - ErrorUtils.setGlobalHandler — RN's primary uncaught-error hook (Hermes + JSC).
 * - addEventListener('unhandledrejection') — picks up Promise rejections on Hermes >= 0.74,
 *   no-op on older runtimes (the user can install promise/setimmediate/rejection-tracking
 *   themselves and forward into captureException).
 *
 * Chains the previous ErrorUtils handler so RN's own LogBox/redbox still fires in dev. The
 * returned unbinder restores the original handler — useful for tests and reset flows.
 */
export function installGlobalHandlers(
  client: ArguslogClient,
  scope: RnGlobalLike = globalThis as RnGlobalLike,
): () => void {
  const errorUtils = scope.ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler();

  const onError: ErrorUtilsHandler = (error, isFatal) => {
    const err = error instanceof Error ? error : new Error(String(error));
    client.captureException(err, {
      level: isFatal ? 'fatal' : 'error',
      tags: { mechanism: 'ErrorUtils' },
    });
    previousHandler?.(error, isFatal);
  };

  errorUtils?.setGlobalHandler(onError);

  const onUnhandled = (event: unknown): void => {
    const reason = (event as { reason?: unknown })?.reason ?? event;
    const err =
      reason instanceof Error
        ? reason
        : new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection');
    client.captureException(err, {
      level: 'error',
      tags: { mechanism: 'unhandledrejection' },
    });
  };

  let rejectionsAttached = false;
  if (typeof scope.addEventListener === 'function') {
    scope.addEventListener('unhandledrejection', onUnhandled);
    rejectionsAttached = true;
  }

  return () => {
    if (errorUtils && previousHandler) {
      errorUtils.setGlobalHandler(previousHandler);
    }
    if (rejectionsAttached && typeof scope.removeEventListener === 'function') {
      scope.removeEventListener('unhandledrejection', onUnhandled);
    }
  };
}
