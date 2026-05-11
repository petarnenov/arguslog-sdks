import { captureException } from '@arguslog/sdk-node';

/**
 * App Router route handler wrapper (app/.../route.ts). Same shape as
 * wrapApiHandler — pass-through on success, capture+rethrow on error.
 * Tagged differently so issues from /app/api are distinguishable from
 * Pages Router issues.
 */
export function wrapRouteHandler<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (err) {
      captureException(err, { tags: { framework: 'nextjs', route: 'app' } });
      throw err;
    }
  };
}
