import { ArguslogClient } from '@arguslog/sdk-core';
import type { ArguslogOptions, Breadcrumb, Level, User } from '@arguslog/sdk-core';

import { BrowserAdapter } from './adapter.js';
import { installConsoleBreadcrumbs } from './integrations/console-breadcrumbs.js';
import { installDomBreadcrumbs } from './integrations/dom-breadcrumbs.js';
import { installFetchBreadcrumbs } from './integrations/fetch-breadcrumbs.js';
import { installGlobalHandlers } from './integrations/global-handlers.js';
import { installHistoryBreadcrumbs } from './integrations/history-breadcrumbs.js';
import { installLongTaskBreadcrumbs } from './integrations/long-tasks.js';
import { installResourceErrorBreadcrumbs } from './integrations/resource-errors.js';
import { installVisibilityBreadcrumbs } from './integrations/visibility.js';
import { installWebVitalsBreadcrumbs } from './integrations/web-vitals.js';
import { installWorkerErrorBreadcrumbs } from './integrations/worker-errors.js';
import { installXhrBreadcrumbs } from './integrations/xhr-breadcrumbs.js';
import { parseStack } from './stack-parser.js';

export type {
  ArguslogOptions,
  Breadcrumb,
  EventPayload,
  Level,
  StackFrame,
  User,
} from '@arguslog/sdk-core';
export { ArguslogClient, InvalidDsnError, parseDsn } from '@arguslog/sdk-core';

let currentClient: ArguslogClient | undefined;
let installedUninstallers: Array<() => void> = [];

/**
 * Each entry maps an integration identifier (the string a consumer passes in {@code
 * ArguslogOptions.integrations}) to its installer. {@code 'autoBreadcrumbs'} is a convenience
 * meta-flag that turns on every breadcrumb integration without needing to list five strings.
 */
const BREADCRUMB_INTEGRATIONS: Array<{
  id: string;
  install: (client: ArguslogClient) => () => void;
}> = [
  { id: 'console', install: installConsoleBreadcrumbs },
  { id: 'fetch', install: installFetchBreadcrumbs },
  { id: 'xhr', install: installXhrBreadcrumbs },
  { id: 'history', install: installHistoryBreadcrumbs },
  { id: 'dom', install: installDomBreadcrumbs },
  { id: 'resourceErrors', install: installResourceErrorBreadcrumbs },
  { id: 'webVitals', install: installWebVitalsBreadcrumbs },
  { id: 'longTasks', install: installLongTaskBreadcrumbs },
  { id: 'visibility', install: installVisibilityBreadcrumbs },
  { id: 'workerErrors', install: installWorkerErrorBreadcrumbs },
];

export function init(options: ArguslogOptions): ArguslogClient {
  // Tear down any prior init's handlers before swapping the client — a hot-reload path can
  // accumulate listeners pointing at a stale ArguslogClient and double-record breadcrumbs.
  for (const off of installedUninstallers) off();
  installedUninstallers = [];

  currentClient = new ArguslogClient(options, {
    adapter: new BrowserAdapter(),
    parseStack,
  });

  const integrations = options.integrations ?? [];
  const auto = integrations.includes('autoBreadcrumbs');

  if (integrations.includes('globalHandlers')) {
    installedUninstallers.push(installGlobalHandlers(currentClient));
  }
  for (const { id, install } of BREADCRUMB_INTEGRATIONS) {
    if (auto || integrations.includes(id)) {
      installedUninstallers.push(install(currentClient));
    }
  }

  return currentClient;
}

export function getClient(): ArguslogClient | undefined {
  return currentClient;
}

export function captureException(
  error: unknown,
  hint?: { level?: Level; tags?: Record<string, string> },
): string | undefined {
  return currentClient?.captureException(error, hint);
}

export function captureMessage(message: string, level?: Level): string | undefined {
  return currentClient?.captureMessage(message, level);
}

export function setUser(user: User | undefined): void {
  currentClient?.setUser(user);
}

export function setTag(key: string, value: string): void {
  currentClient?.setTag(key, value);
}

export function setContext(name: string, ctx: Record<string, unknown>): void {
  currentClient?.setContext(name, ctx);
}

export function addBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void {
  currentClient?.addBreadcrumb(crumb);
}

export function flush(): Promise<void> {
  return currentClient?.flush() ?? Promise.resolve();
}

/** Test-only: reset the singleton client between tests. */
export function __resetForTests(): void {
  for (const off of installedUninstallers) off();
  installedUninstallers = [];
  currentClient = undefined;
}
