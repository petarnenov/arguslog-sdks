import { captureException } from '@arguslog/sdk-node';

/**
 * Wraps a Server Action ('use server' function). Server actions throw
 * the special Next.js `redirect()` and `notFound()` errors as a control
 * flow mechanism — those are not real errors and must propagate without
 * being captured, otherwise every redirect lands in the issue tracker.
 *
 * Detection mirrors next/dist/client/components: the thrown value has
 * a `digest` property whose string starts with `NEXT_REDIRECT` or
 * `NEXT_NOT_FOUND`.
 */
export function wrapServerAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => TResult | Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    try {
      return await action(...args);
    } catch (err) {
      if (isNextControlFlowError(err)) throw err;
      captureException(err, { tags: { framework: 'nextjs', route: 'server-action' } });
      throw err;
    }
  };
}

function isNextControlFlowError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== 'string') return false;
  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND');
}
