export { wrapApiHandler } from './wrap-api-handler.js';
export { wrapRouteHandler } from './wrap-route-handler.js';
export { wrapServerAction } from './wrap-server-action.js';
export { onRequestError, type ErrorContext, type RequestInfo } from './on-request-error.js';

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
  runWithRequestScope,
  type NodeArguslogOptions,
  type Level,
  type EventPayload,
} from '@arguslog/sdk-node';
