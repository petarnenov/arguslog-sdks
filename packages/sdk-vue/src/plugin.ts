import { init, type ArguslogOptions } from '@arguslog/sdk-browser';
import type { App, Plugin } from 'vue';

import { ArguslogService } from './arguslog-service.js';
import { installVueErrorHandler } from './error-handler.js';
import { ARGUSLOG_KEY } from './injection-keys.js';

export interface ArguslogPluginOptions extends ArguslogOptions {
  /**
   * If `false`, the plugin will not replace `app.config.errorHandler`.
   * Useful when the host app composes its own handler chain.
   * Default: `true`.
   */
  attachErrorHandler?: boolean;
}

/**
 * Returns a Vue plugin that initialises Arguslog, registers a global error
 * handler, and provides an `ArguslogService` for `useArguslog()` consumers.
 *
 * @example
 * import { createApp } from 'vue';
 * import { createArguslog } from '@arguslog/sdk-vue';
 * import App from './App.vue';
 *
 * createApp(App)
 *   .use(createArguslog({ dsn: 'arguslog://k@host/api/1' }))
 *   .mount('#app');
 */
export function createArguslog(options: ArguslogPluginOptions): Plugin {
  const { attachErrorHandler = true, ...rest } = options;
  return {
    install(app: App) {
      init(rest);
      if (attachErrorHandler) {
        installVueErrorHandler(app);
      }
      app.provide(ARGUSLOG_KEY, new ArguslogService());
    },
  };
}
