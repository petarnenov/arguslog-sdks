export { ArguslogErrorBoundary } from './error-boundary.js';
export { ArguslogService } from './arguslog-service.js';
export { createArguslog, type ArguslogPluginOptions } from './plugin.js';
export { useArguslog } from './composable.js';
export { installVueErrorHandler, vueErrorHandler } from './error-handler.js';
export { ARGUSLOG_KEY } from './injection-keys.js';

export {
  init,
  captureException,
  captureMessage,
  setUser,
  setTag,
  setContext,
  addBreadcrumb,
  flush,
  getClient,
  type ArguslogOptions,
  type Level,
  type EventPayload,
} from '@arguslog/sdk-browser';
