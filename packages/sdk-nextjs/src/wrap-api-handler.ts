import { captureException } from '@arguslog/sdk-node';

/**
 * Pages Router API handler wrapper. Pass-through on success; on throw,
 * captures the error tagged with `framework: nextjs, route: api` and
 * re-throws so Next.js still renders the default error response.
 *
 * The wrapper is generic so user handler signatures (e.g. typed req/res)
 * are preserved; we don't depend on next/server types here so the same
 * wrapper works for any (...args) => Promise<unknown> shape, including
 * the legacy `(req: NextApiRequest, res: NextApiResponse)` form.
 */
export function wrapApiHandler<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (err) {
      captureException(err, { tags: { framework: 'nextjs', route: 'api' } });
      throw err;
    }
  };
}
