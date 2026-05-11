# @arguslog/sdk-node

[![npm version](https://img.shields.io/npm/v/@arguslog/sdk-node.svg)](https://www.npmjs.com/package/@arguslog/sdk-node)
[![license](https://img.shields.io/npm/l/@arguslog/sdk-node.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

Node.js SDK for [Arguslog](https://arguslog.org) — a multi-tenant error tracking platform.
Captures unhandled exceptions, unhandled promise rejections, and manually-reported errors
from any Node 18.18+ app, then ships them to the Arguslog ingest endpoint where they're
fingerprinted, stored, and surfaced on the dashboard.

Ships ESM only. Built on `@arguslog/sdk-core`. The only runtime dep is sdk-core itself.
Express integration ships under the `/express` subpath and is a peer-dep — opt in by
installing `express` alongside.

## Install

```bash
pnpm add @arguslog/sdk-node
# or
npm install @arguslog/sdk-node
# or
yarn add @arguslog/sdk-node
```

## Quick start

Initialize once at the very top of your entry file — before anything else `require`s a
module that might throw on load. The SDK is a no-op until `init` runs.

```ts
import { init } from '@arguslog/sdk-node';

init({
  dsn: 'arguslog://<key>@<host>/api/<projectId>',
  release: process.env.RELEASE ?? 'dev',
  environment: process.env.NODE_ENV,
  integrations: ['processHandlers', 'http'],
  sourcemaps: { enabled: true }, // resolves stack traces against your built .map files
});
```

After `init`, `process.on('uncaughtException')` and `process.on('unhandledRejection')` are
captured automatically (when `processHandlers` is in `integrations`). Manual reporting is
always available via `captureException` / `captureMessage`.

## DSN format

```
arguslog://<publicKey>@<host>/api/<projectId>
```

Get yours from your Arguslog project settings page. The `publicKey` is project-scoped —
it's intended to be safe to ship in compiled binaries, but on a server you can also load
it from `process.env` like any other secret.

## API

### `init(options): ArguslogClient`

Configures and starts the SDK. Re-initializing tears down the previous handlers cleanly,
so hot-reload during dev doesn't accumulate stale `process` listeners.

```ts
init({
  dsn: '…',
  release: '1.4.0',
  environment: 'production',
  sampleRate: 1.0,
  maxBreadcrumbs: 50,
  beforeSend: (event) => {
    if (event.message?.includes('SECRET')) return null; // drop
    return event;
  },
  scrubbing: { enabled: true, extraPatterns: [/cust_[a-z0-9]+/g] },
  integrations: ['processHandlers', 'http'],
  processHandlers: { exitOnUncaught: false }, // default keeps Node's "throw" behavior
  sourcemaps: { enabled: true },
});
```

| Option            | Type                                              | Default      | Notes                                                                  |
| ----------------- | ------------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| `dsn`             | `string`                                          | _required_   | See above.                                                             |
| `release`         | `string`                                          | _none_       | Free-form version tag stamped on every event.                          |
| `environment`     | `string`                                          | _none_       | E.g. `production`, `staging`, `dev`.                                   |
| `sampleRate`      | `number` 0–1                                      | `1.0`        | Fraction of events kept.                                               |
| `maxBreadcrumbs`  | `number`                                          | `50`         | Per-request ring-buffer size.                                          |
| `beforeSend`      | `(event) => event \| null \| Promise<...>`        | _identity_   | Last-mile mutate / drop hook.                                          |
| `scrubbing`       | `{ enabled?: boolean; extraPatterns?: RegExp[] }` | enabled      | PII redaction in messages and URLs.                                    |
| `transport`       | `{ fetch?: typeof fetch; maxRetries?: number }`   | global fetch | Inject a custom fetch (testing) or bump retry budget.                  |
| `integrations`    | `('processHandlers' \| 'http')[]`                 | _none_       | See **Integrations** below.                                            |
| `processHandlers` | `{ exitOnUncaught?: boolean }`                    | `{}`         | If `true`, `process.exit(1)` after capturing an `uncaughtException`.   |
| `sourcemaps`      | `{ enabled?: boolean }`                           | _disabled_   | Calls `process.setSourceMapsEnabled(true)` so stacks show original TS. |
| `debug`           | `boolean`                                         | `false`      | Logs every send to console — never enable in production.               |

### `captureException(error, hint?)`

```ts
import { captureException } from '@arguslog/sdk-node';

try {
  await chargeCard(orderId);
} catch (err) {
  captureException(err, { level: 'error', tags: { feature: 'billing' } });
}
```

Non-`Error` values are wrapped synthetically. Returns the generated event id, or
`undefined` if the SDK isn't initialized.

### `captureMessage(message, level?)`

```ts
captureMessage('Worker idle for 5m', 'warning');
```

### Scope mutation

```ts
setUser({ id: 'u-1234', email: 'alice@example.com' }); // email is auto-scrubbed
setTag('region', 'eu-west');
setContext('order', { id: 42, total_cents: 9900 });
addBreadcrumb({ category: 'queue', message: 'job dequeued', level: 'info', data: { jobId } });
```

By default, scope is **per-request** when you use the Express middleware (or
`runWithRequestScope`) — so concurrent requests don't bleed users into each other's
events. Outside a request scope, mutations apply to the global fallback scope.

### `flush()`

```ts
await flush();
```

Drains pending sends. **Always call before the process exits** in short-lived workloads
(CLIs, cron jobs, AWS Lambda, Cloud Run requests) — Node will tear down the event loop
before background sends complete otherwise.

## Integrations

### `processHandlers`

Captures `uncaughtException` and `unhandledRejection`. By default the SDK lets Node's
normal "fatal exception → exit" behavior continue once the event is queued; set
`processHandlers.exitOnUncaught: false` if you have a process supervisor that will
restart you and you'd rather not double-emit.

```ts
init({
  dsn,
  integrations: ['processHandlers'],
  processHandlers: { exitOnUncaught: true },
});
```

### `http`

Auto-instruments outbound `http`/`https` requests, dropping a breadcrumb per request with
method, URL, and status code. Useful for "what was this service talking to right before
it crashed?" debugging.

```ts
init({ dsn, integrations: ['http'] });
```

The integration patches `http.request` / `https.request` — there's no async-hooks wizardry
and no work done if the integration isn't enabled.

### Source maps

```ts
init({ dsn, sourcemaps: { enabled: true } });
```

Calls `process.setSourceMapsEnabled(true)` so `Error.stack` reports your original TypeScript
filenames + line numbers instead of the bundled `.js` ones. Pair with **uploading** the
maps to Arguslog so the dashboard can deminify production traces — see the
[`@arguslog/cli`](https://www.npmjs.com/package/@arguslog/cli) README for the upload flow:

```bash
npx @arguslog/cli releases new "$VERSION" --project 42
npx @arguslog/cli sourcemaps upload dist/server.js.map \
  --project 42 --release "$RELEASE_ID" --name dist/server.js
```

## Express

The Express middleware lives at `@arguslog/sdk-node/express`. It uses `AsyncLocalStorage`
for per-request scope isolation, so concurrent requests don't bleed users into each
other's breadcrumbs/tags.

```ts
import express from 'express';
import { init } from '@arguslog/sdk-node';
import { requestHandler, errorHandler } from '@arguslog/sdk-node/express';

init({
  dsn: process.env.ARGUSLOG_DSN!,
  integrations: ['processHandlers', 'http'],
  release: process.env.RELEASE,
});

const app = express();

// First — opens an isolated scope for every request.
app.use(requestHandler());

app.use(express.json());
app.use('/api', apiRoutes);

// Last — captures anything that propagates out of a route or middleware.
app.use(errorHandler());

app.listen(3000);
```

Inside a route, scope mutations are request-scoped:

```ts
app.get('/users/:id', async (req, res) => {
  setUser({ id: req.params.id }); // visible only on this request's events
  setTag('endpoint', 'GET /users/:id');
  res.json(await loadUser(req.params.id));
});
```

`requestHandler()` also drops a breadcrumb per request with method + path so failed
requests carry the route they came from.

## Custom request scopes (queues, gRPC, …)

For non-Express workloads, wrap each unit of work in `runWithRequestScope`:

```ts
import { runWithRequestScope, setTag, captureException } from '@arguslog/sdk-node';

queue.process(async (job) => {
  await runWithRequestScope(async () => {
    setTag('job', job.name);
    setTag('jobId', String(job.id));
    try {
      await job.run();
    } catch (err) {
      captureException(err);
      throw err;
    }
  });
});
```

Each invocation gets its own forked scope; tags from one job don't leak into the next.

## AWS Lambda / serverless

The recipe is the same except `flush()` becomes mandatory — Lambda freezes the runtime
the moment your handler returns, which strands any in-flight sends.

```ts
import { init, captureException, flush } from '@arguslog/sdk-node';

init({ dsn: process.env.ARGUSLOG_DSN!, release: process.env.AWS_LAMBDA_FUNCTION_VERSION });

export const handler = async (event) => {
  try {
    return await businessLogic(event);
  } catch (err) {
    captureException(err);
    throw err;
  } finally {
    await flush(); // critical
  }
};
```

## Configuration tips

- **Capture early.** Call `init` at the very top of your entry file. Errors thrown during
  module evaluation of files imported _before_ `init` won't be captured.
- **One `init` per process.** Re-initializing is safe (handlers are torn down and
  re-installed) but you generally don't need to.
- **`debug: true` is for development only.** It logs every event to the console; in
  production it doubles your stderr volume.
- **Long-lived servers don't need `flush()`** — the transport's background queue drains
  during normal request idleness. Short-lived processes do.

## Troubleshooting

**Events not appearing on the dashboard.**
Check `release` matches what you uploaded sourcemaps under — the dashboard groups by
exact match. Also check that the DSN's `host` is reachable from your server (not just
your laptop) — a corporate proxy or NAT can strand HTTPS to the ingest endpoint.

**`Cannot find module '@arguslog/sdk-node/express'`.**
Express is a peer dep — install it: `pnpm add express`. Then make sure your bundler/runner
supports the `exports` map in package.json (Node 18+ does natively).

**Concurrent requests show each other's user/tags.**
You're mutating scope outside `requestHandler()`. Mount it as the **first** middleware in
your Express stack, or wrap the work in `runWithRequestScope`.

**Stack traces show bundled `.js` paths instead of `.ts`.**
You forgot `sourcemaps: { enabled: true }`, _or_ your build isn't emitting `.map` files,
_or_ you're running a transpiled-on-startup loader (tsx/ts-node) that doesn't surface
maps to V8. Switch to a build step that emits maps + `init` with `sourcemaps.enabled`.

## Source

The full implementation lives in the [arguslog monorepo](https://github.com/petarnenov/arguslog)
at `packages/sdk-node/`. Issues and PRs welcome.
