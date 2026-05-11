import type { ErrorRequestHandler, RequestHandler } from 'express';

import { addBreadcrumb, captureException, runWithRequestScope } from './index.js';

/**
 * Express middleware that opens a per-request Arguslog scope. Mount it as the first middleware
 * so every later middleware (and route handler) sees an isolated scope:
 *
 *   app.use(requestHandler());
 *   app.use(otherMiddleware);
 *   app.use(routes);
 *   app.use(errorHandler());   // last
 *
 * Within a request, `setUser` / `setTag` / `addBreadcrumb` write to the request scope — they do
 * NOT leak into other concurrent requests (AsyncLocalStorage isolation).
 */
export function requestHandler(): RequestHandler {
  return (req, _res, next) => {
    runWithRequestScope(() => {
      addBreadcrumb({
        category: 'http',
        message: `${req.method} ${req.path}`,
        level: 'info',
        data: { method: req.method, path: req.path },
      });
      next();
    });
  };
}

/**
 * Express error-handling middleware (4-arg). Captures any error that propagates from a route or
 * middleware as a fatal-but-handled exception, tagged with the request method and path. Always
 * calls `next(err)` so the user's own error-rendering middleware still runs.
 */
export function errorHandler(): ErrorRequestHandler {
  return (err, req, _res, next) => {
    captureException(err, {
      level: 'error',
      tags: {
        'http.method': req.method,
        'http.path': req.path,
      },
    });
    next(err);
  };
}
