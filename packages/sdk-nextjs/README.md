# @arguslog/sdk-nextjs

[![npm version](https://img.shields.io/npm/v/@arguslog/sdk-nextjs.svg)](https://www.npmjs.com/package/@arguslog/sdk-nextjs)
[![license](https://img.shields.io/npm/l/@arguslog/sdk-nextjs.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

Next.js SDK for [Arguslog](https://arguslog.org) — a multi-tenant error tracking platform.
Wraps [`@arguslog/sdk-react`](https://www.npmjs.com/package/@arguslog/sdk-react) for the
client and [`@arguslog/sdk-node`](https://www.npmjs.com/package/@arguslog/sdk-node) for
the server, plus helpers for App Router route handlers, server actions, Pages Router API
routes, and the `instrumentation.ts` `onRequestError` hook introduced in Next.js 15.

Ships ESM only. Supports Next.js 13.4 through 15.x, React 18 or 19, on both Node.js and
the Edge runtime.

## Install

```bash
pnpm add @arguslog/sdk-nextjs
# or
npm install @arguslog/sdk-nextjs
# or
yarn add @arguslog/sdk-nextjs
```

The package exposes two import paths:

- `@arguslog/sdk-nextjs/server` — Node-only helpers (route wrappers, instrumentation).
- `@arguslog/sdk-nextjs/client` — browser/RSC client helpers (re-exports from `sdk-react`).

There is no default export — pick the one that matches the file you're editing.

## Server: `instrumentation.ts` (recommended)

Next.js 15 introduced the `instrumentation.ts` file conventions. Create
`instrumentation.ts` at the repo root (or `src/instrumentation.ts` if you use `src/`):

```ts
import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@arguslog/sdk-nextjs/server');
    init({
      dsn: process.env.ARGUSLOG_DSN!,
      release: process.env.RELEASE,
      environment: process.env.NODE_ENV,
      integrations: ['processHandlers', 'http'],
      sourcemaps: { enabled: true },
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, ctx) => {
  const { onRequestError } = await import('@arguslog/sdk-nextjs/server');
  onRequestError(err, request, ctx);
};
```

`onRequestError` runs for every error thrown during a request, regardless of router
(App or Pages), runtime (Node or Edge), or kind (`render`, `route`, `action`,
`middleware`). The exported helper tags events with the route, router kind, route type,
and HTTP method so you can filter on them in the dashboard.

The dynamic `import()` matters: it keeps the Node SDK out of Edge bundles when Next
builds for both runtimes.

## App Router: route handlers

For App Router endpoints under `app/api/.../route.ts`, wrap your handler so any
unhandled throw is captured before being re-thrown for Next to render the error page:

```ts
import { wrapRouteHandler } from '@arguslog/sdk-nextjs/server';
import { NextResponse } from 'next/server';

export const POST = wrapRouteHandler(async (req: Request) => {
  const body = await req.json();
  const result = await chargeCard(body); // throws on failure
  return NextResponse.json(result);
});
```

`wrapRouteHandler` is a no-op on success and `captureException` + rethrow on failure, so
your existing error-rendering chain (Next's `error.tsx`, custom error pages) keeps
working.

## App Router: server actions

```ts
'use server';

import { wrapServerAction } from '@arguslog/sdk-nextjs/server';

export const submitOrder = wrapServerAction(async (input: OrderInput) => {
  const order = await createOrder(input);
  if (!order.eligible) throw new Error('Customer ineligible'); // captured
  redirect(`/orders/${order.id}`); // NOT captured (Next control flow)
});
```

The wrapper detects Next's `redirect()` and `notFound()` control-flow throws (their
`digest` strings start with `NEXT_REDIRECT` / `NEXT_NOT_FOUND`) and lets them propagate
silently — otherwise every redirect from a server action would land in your issue
tracker. Real errors still get captured.

## Pages Router: API routes

```ts
import { wrapApiHandler } from '@arguslog/sdk-nextjs/server';
import type { NextApiRequest, NextApiResponse } from 'next';

export default wrapApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const result = await fetchData(req.query.id as string);
  res.json(result);
});
```

Same shape as `wrapRouteHandler` but tagged as `route: 'pages'` so you can filter App
Router vs Pages Router issues separately.

## Client: capturing component errors

The `client` subpath re-exports the React SDK so you don't have to install it separately:

```tsx
'use client';

import { ArguslogErrorBoundary, useArguslog } from '@arguslog/sdk-nextjs/client';

export function Checkout() {
  const arguslog = useArguslog();

  async function pay() {
    try {
      await charge();
    } catch (err) {
      arguslog.captureException(err, { tags: { feature: 'checkout' } });
    }
  }

  return (
    <ArguslogErrorBoundary fallback={<p>Something went wrong.</p>}>
      <button onClick={pay}>Pay now</button>
    </ArguslogErrorBoundary>
  );
}
```

Initialise the client SDK once — typically inside your root layout or a top-level client
component. The cleanest pattern is a tiny `Providers` client component:

```tsx
// app/providers.tsx
'use client';

import { useEffect } from 'react';
import { init } from '@arguslog/sdk-nextjs/client';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    init({
      dsn: process.env.NEXT_PUBLIC_ARGUSLOG_DSN!,
      release: process.env.NEXT_PUBLIC_RELEASE,
      environment: process.env.NODE_ENV,
      integrations: ['globalHandlers', 'autoBreadcrumbs'],
    });
  }, []);

  return <>{children}</>;
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Notice the env var is `NEXT_PUBLIC_…` — the client SDK runs in the browser, so the DSN
needs to be inlined into the bundle. The DSN's `publicKey` is project-scoped and safe
to expose; rotate it from the Arguslog dashboard if it ever leaks.

## Sourcemap upload

Production stack traces are useless without sourcemaps. The release flow is the same as
any other Node/JS app:

```bash
# In your CI release pipeline, after `next build`:
arguslog releases new "$RELEASE" --project 42
RELEASE_ID=$(arguslog releases new "$RELEASE" --project 42 | sed -nE 's/^release #([0-9]+).*/\1/p')

# Server bundles
for map in .next/server/**/*.js.map; do
  arguslog sourcemaps upload "$map" --project 42 --release "$RELEASE_ID" --name "${map%.map}"
done

# Client bundles
for map in .next/static/chunks/**/*.js.map; do
  arguslog sourcemaps upload "$map" --project 42 --release "$RELEASE_ID" --name "${map%.map}"
done
```

See the [`@arguslog/cli`](https://www.npmjs.com/package/@arguslog/cli) README for the
full GitHub Actions workflow.

`next.config.js` must enable production sourcemaps so they exist to upload:

```js
module.exports = {
  productionBrowserSourceMaps: true,
};
```

The `release` you pass to client `init()` and server `init()` must match the `<version>`
passed to `arguslog releases new` — exact string match.

## API reference

### `@arguslog/sdk-nextjs/server`

| Export                | Kind | Purpose                                                                              |
| --------------------- | ---- | ------------------------------------------------------------------------------------ |
| `init(options)`       | fn   | Re-export of `@arguslog/sdk-node` `init`. Call from `instrumentation.ts`.            |
| `onRequestError`      | fn   | Drop-in for `Instrumentation.onRequestError` in Next.js 15.                          |
| `wrapRouteHandler`    | fn   | App Router `app/.../route.ts` wrapper. Capture-and-rethrow.                          |
| `wrapApiHandler`      | fn   | Pages Router `pages/api/*.ts` wrapper. Same shape, different route tag.              |
| `wrapServerAction`    | fn   | `'use server'` wrapper that lets `redirect()`/`notFound()` propagate.                |
| Capture API           | fn   | `captureException`, `captureMessage`, `setUser`, `setTag`, `addBreadcrumb`, `flush`. |
| `runWithRequestScope` | fn   | Manual scope wrapper for non-route work (cron, queue workers).                       |
| `ErrorContext`        | type | Local copy of Next's `Instrumentation.onRequestError` ctx shape.                     |
| `RequestInfo`         | type | Local copy of Next's request info shape.                                             |

### `@arguslog/sdk-nextjs/client`

| Export                  | Kind      | Purpose                                                                              |
| ----------------------- | --------- | ------------------------------------------------------------------------------------ |
| `init(options)`         | fn        | Re-export of `@arguslog/sdk-react` `init`. Call once from a client comp.             |
| `ArguslogErrorBoundary` | component | React error boundary that captures + renders a fallback.                             |
| `useArguslog()`         | hook      | Returns the client wrapper for capture/scope mutations.                              |
| Capture API             | fn        | `captureException`, `captureMessage`, `setUser`, `setTag`, `addBreadcrumb`, `flush`. |

## Edge runtime

For routes you've forced onto the Edge runtime (`export const runtime = 'edge'`), the
Node SDK won't load — its dependencies on `node:async_hooks`, `node:http`, etc. would
crash on load. Use only the client-style capture API in Edge code, or skip capture there
and rely on `onRequestError` from `instrumentation.ts` (which Next routes to the Node
runtime regardless).

## Environment variables

| Variable                          | Where  | Purpose                                                     |
| --------------------------------- | ------ | ----------------------------------------------------------- |
| `ARGUSLOG_DSN`                    | server | DSN for the server SDK. Server-only, never in bundles.      |
| `NEXT_PUBLIC_ARGUSLOG_DSN`        | client | DSN inlined into the browser bundle.                        |
| `RELEASE` / `NEXT_PUBLIC_RELEASE` | both   | Release tag. Must match what you uploaded sourcemaps under. |
| `ARGUSLOG_TOKEN`                  | CI     | Personal access token for the CLI (releases + sourcemaps).  |

## Troubleshooting

**`Module not found: Can't resolve 'node:http'` in Edge build.**
You imported from `@arguslog/sdk-nextjs/server` in a route that runs on the Edge runtime.
Move the import inside a `if (process.env.NEXT_RUNTIME === 'nodejs')` branch, or use
the client subpath instead.

**`onRequestError` fires but no event lands on the dashboard.**
The instrumentation file has its own bundle context — `init()` may not have run yet, or
ran in a different worker. Make sure `register()` does the `init` call (not the module
top level) and that you're not gating it behind `if (process.env.NODE_ENV === 'production')`
during local debugging.

**Server actions wrapped in `wrapServerAction` still log redirects.**
Double-check the imported symbol — only `wrapServerAction` understands the
`NEXT_REDIRECT` digest. Using `wrapRouteHandler` for a server action will log every
redirect.

**Stack traces show minified `chunks/abc123.js` paths.**
Set `productionBrowserSourceMaps: true` in `next.config.js`, run a fresh build, then
upload the `.map` files with the CLI. Next emits client maps under `.next/static/` and
server maps under `.next/server/`.

**The Edge runtime doesn't capture errors.**
Capture in Edge has to go through `instrumentation.ts onRequestError` because the Node
SDK doesn't run there. There's no in-Edge `init()` story today.

## Source

The full implementation lives in the [arguslog monorepo](https://github.com/petarnenov/arguslog)
at `packages/sdk-nextjs/`. Issues and PRs welcome.
