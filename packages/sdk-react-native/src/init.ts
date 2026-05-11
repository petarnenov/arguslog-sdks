import {
  __resetForTests as __resetBrowserForTests,
  type ArguslogClient,
  init as initBrowser,
} from '@arguslog/sdk-browser';

import { installGlobalHandlers } from './integrations/global-handlers.js';
import type { RnArguslogOptions } from './types.js';

let uninstallRnGlobalHandlers: (() => void) | undefined;

export function init(options: RnArguslogOptions): ArguslogClient {
  // Tear down anything we installed last time so hot-reload doesn't double-bind.
  uninstallRnGlobalHandlers?.();
  uninstallRnGlobalHandlers = undefined;

  // Strip 'globalHandlers' before delegating: the browser SDK would otherwise try to wire
  // window.onerror, which is a no-op in RN. We install the RN-native equivalent ourselves.
  const wantsGlobalHandlers = options.integrations?.includes('globalHandlers') ?? false;
  const client = initBrowser({
    ...options,
    integrations: undefined,
  });

  if (wantsGlobalHandlers) {
    uninstallRnGlobalHandlers = installGlobalHandlers(client);
  }

  return client;
}

/** Test-only: reset RN-side handlers and the underlying browser singleton. */
export function __resetForTests(): void {
  uninstallRnGlobalHandlers?.();
  uninstallRnGlobalHandlers = undefined;
  __resetBrowserForTests();
}
