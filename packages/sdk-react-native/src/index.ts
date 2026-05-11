export { ArguslogErrorBoundary } from './error-boundary.js';
export { useArguslog } from './hooks.js';
export { init, __resetForTests } from './init.js';
export { installGlobalHandlers } from './integrations/global-handlers.js';
export { installAppStateBreadcrumbs } from './integrations/app-state.js';
export type {
  AppStateLike,
  AppStateStatus,
  AppStateSubscriptionLike,
  ErrorUtilsHandler,
  ErrorUtilsLike,
  RnArguslogOptions,
  RnIntegration,
} from './types.js';

export {
  captureException,
  captureMessage,
  setUser,
  setTag,
  setContext,
  addBreadcrumb,
  flush,
  getClient,
  type ArguslogOptions,
  type Breadcrumb,
  type EventPayload,
  type Level,
  type StackFrame,
  type User,
} from '@arguslog/sdk-browser';
