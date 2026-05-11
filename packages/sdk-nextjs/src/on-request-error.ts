import { captureException } from '@arguslog/sdk-node';

/**
 * Shape of the third argument Next.js 15 passes to instrumentation
 * `onRequestError`. We type it locally instead of importing from `next`
 * so the package compiles without a Next install at build time.
 *
 * See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation#onrequesterror-optional
 */
export interface ErrorContext {
  routerKind: 'Pages Router' | 'App Router';
  routePath: string;
  routeType: 'render' | 'route' | 'action' | 'middleware';
  renderSource?: 'react-server-components' | 'react-server-components-payload' | 'server-rendering';
  revalidateReason?: 'on-demand' | 'stale' | undefined;
  renderType?: 'dynamic' | 'dynamic-resume';
}

export interface RequestInfo {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Drop-in for Next.js 15 `instrumentation.ts` `onRequestError`. Captures
 * the error with route/router/type tags so downstream filtering can
 * pivot on those without parsing message text.
 */
export function onRequestError(err: unknown, request: RequestInfo, context: ErrorContext): void {
  captureException(err, {
    tags: {
      framework: 'nextjs',
      'next.router': context.routerKind === 'App Router' ? 'app' : 'pages',
      'next.route': context.routePath,
      'next.routeType': context.routeType,
      'http.method': request.method,
    },
  });
}
