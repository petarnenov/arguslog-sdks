import { getCurrentInstance, inject } from 'vue';

import { ArguslogService } from './arguslog-service.js';
import { ARGUSLOG_KEY } from './injection-keys.js';

/**
 * Returns the `ArguslogService` provided by `createArguslog()`. When called
 * outside of a Vue component setup, or before the plugin has been installed,
 * a fresh service instance is returned so callers can still proxy to the
 * underlying `@arguslog/sdk-browser` singleton.
 */
export function useArguslog(): ArguslogService {
  if (getCurrentInstance()) {
    const provided = inject(ARGUSLOG_KEY, null);
    if (provided) return provided;
  }
  return new ArguslogService();
}
