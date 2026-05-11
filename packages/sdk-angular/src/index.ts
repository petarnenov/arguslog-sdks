export { ArguslogErrorHandler } from './error-handler.js';
export { ArguslogService } from './arguslog.service.js';
export { ArguslogModule } from './arguslog.module.js';
export { provideArguslog } from './provide-arguslog.js';
export { ARGUSLOG_OPTIONS } from './tokens.js';

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
