import { addBreadcrumb } from '@arguslog/sdk-browser';

import type { AppStateLike, AppStateStatus } from '../types.js';

/**
 * Records foreground/background transitions as breadcrumbs. AppState is injected (not imported)
 * so this module can be loaded in test environments without `react-native` resolved.
 *
 * Usage:
 *   import { AppState } from 'react-native';
 *   installAppStateBreadcrumbs(AppState);
 */
export function installAppStateBreadcrumbs(appState: AppStateLike): () => void {
  const onChange = (status: AppStateStatus): void => {
    addBreadcrumb({
      category: 'app.lifecycle',
      message: `AppState → ${status}`,
      level: 'info',
      data: { state: status },
    });
  };
  const subscription = appState.addEventListener('change', onChange);
  return () => subscription.remove();
}
