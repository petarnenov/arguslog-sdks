export { ArguslogErrorBoundary } from './error-boundary.js';
export { useArguslog } from './hooks.js';

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
