# @arguslog/sdk-core

[![npm version](https://img.shields.io/npm/v/@arguslog/sdk-core.svg)](https://www.npmjs.com/package/@arguslog/sdk-core)
[![license](https://img.shields.io/npm/l/@arguslog/sdk-core.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

Platform-agnostic foundation for the [Arguslog](https://arguslog.org) SDKs. Holds the
event pipeline (DSN parsing, scope, breadcrumbs, scrubbing, transport, retry/backoff) so
each platform package — `@arguslog/sdk-browser`, `@arguslog/sdk-node`, `@arguslog/sdk-react`,
`@arguslog/sdk-vue`, `@arguslog/sdk-angular`, `@arguslog/sdk-react-native`,
`@arguslog/sdk-nextjs` — can stay thin and just contribute a `PlatformAdapter` plus a
`StackParser`.

Ships ESM only. No runtime dependencies.

> **You probably don't want this directly.** If you're building a normal app, install
> `@arguslog/sdk-browser`, `@arguslog/sdk-node`, or one of the framework packages — they
> pull in `sdk-core` as a transitive dep and give you a much friendlier surface.
>
> Use `@arguslog/sdk-core` directly when you're writing a **new platform integration**
> (e.g. Bun, Deno, Workers, Electron main process, Lambda runtime) and want to share the
> battle-tested pipeline instead of reinventing it.

## Install

```bash
pnpm add @arguslog/sdk-core
# or
npm install @arguslog/sdk-core
# or
yarn add @arguslog/sdk-core
```

## What's in the box

| Export             | Kind  | Purpose                                                                        |
| ------------------ | ----- | ------------------------------------------------------------------------------ |
| `ArguslogClient`   | class | The event pipeline. Everything routes through here.                            |
| `parseDsn`         | fn    | Parses an `arguslog://key@host/api/projectId` DSN into a `ParsedDsn`.          |
| `InvalidDsnError`  | class | Thrown by `parseDsn` for malformed input.                                      |
| `Transport`        | class | Sends `EventPayload`s to the ingest endpoint with retry/backoff.               |
| `Scrubber`         | class | PII redaction (emails, IPs, credit-card numbers, custom regexes).              |
| `BreadcrumbBuffer` | class | Bounded ring buffer for breadcrumbs.                                           |
| `GlobalScope`      | class | Default `ScopeStore` — single shared user/tags/contexts/breadcrumbs.           |
| `ScopeStore`       | type  | Interface platform adapters implement to swap in per-request scope (sdk-node). |
| `PlatformAdapter`  | type  | What each platform package contributes to the client.                          |
| `StackParser`      | type  | `(stack: string \| undefined) => StackFrame[]` — platforms ship one.           |
| Event/option types | type  | `ArguslogOptions`, `EventPayload`, `Breadcrumb`, `User`, `Level`, …            |
| `SDK_VERSION`      | const | Semver of the published `sdk-core` build, stamped on every event.              |

## Building a platform integration

Three pieces wire `sdk-core` to a new platform:

1. A **`PlatformAdapter`** that names the SDK and (optionally) enriches events with
   platform-only fields.
2. A **`StackParser`** that turns a raw `Error.stack` string into `StackFrame[]` for the
   target runtime.
3. Optionally, a custom **`ScopeStore`** if the platform supports per-request scope
   (e.g. async-context based isolation in a server runtime).

### Minimal example — Bun runtime adapter

```ts
import {
  ArguslogClient,
  type ArguslogOptions,
  type EventPayload,
  type PlatformAdapter,
  type StackParser,
  type StackFrame,
} from '@arguslog/sdk-core';

const bunAdapter: PlatformAdapter = {
  sdkName: 'arguslog.bun',
  platform: 'node', // closest match in the existing taxonomy
  enrichEvent(event: EventPayload) {
    event.contexts = {
      ...(event.contexts ?? {}),
      runtime: { name: 'bun', version: Bun.version },
    };
  },
};

// Cheap-and-cheerful stack parser. Real platforms ship a more thorough one — see how
// sdk-node and sdk-browser do it in the monorepo.
const parseStack: StackParser = (stack) => {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const m = /at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?/.exec(raw);
    if (m) {
      frames.push({
        function: m[1] || '<anonymous>',
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
        inApp: !m[2].includes('node_modules'),
      });
    }
  }
  return frames.reverse(); // oldest frame first
};

export function init(options: ArguslogOptions): ArguslogClient {
  return new ArguslogClient(options, { adapter: bunAdapter, parseStack });
}
```

Consumer code:

```ts
import { init } from './arguslog-bun.js';

const client = init({
  dsn: 'arguslog://<key>@<host>/api/<projectId>',
  release: process.env.RELEASE,
  environment: 'production',
});

try {
  await riskyThing();
} catch (err) {
  client.captureException(err, { tags: { feature: 'checkout' } });
}

await client.flush();
```

## ArguslogClient API

`new ArguslogClient(options, deps)` — no implicit globals; the client is a plain object.

### Construction

```ts
new ArguslogClient(options: ArguslogOptions, deps: ClientDeps)
```

`ArguslogOptions` (all optional except `dsn`):

| Option           | Type                                              | Default  | Notes                                                                 |
| ---------------- | ------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `dsn`            | `string`                                          | required | `arguslog://<publicKey>@<host>/api/<projectId>`. Throws on malformed. |
| `release`        | `string`                                          | none     | Free-form — git sha, semver, build number.                            |
| `environment`    | `string`                                          | none     | E.g. `production`, `staging`, `dev`.                                  |
| `sampleRate`     | `number` (0..1)                                   | `1.0`    | Fraction of events kept.                                              |
| `maxBreadcrumbs` | `number`                                          | `50`     | Ring-buffer size for the default `GlobalScope`.                       |
| `beforeSend`     | `(event) => event \| null \| Promise<...>`        | identity | Last-mile mutate / drop hook. Return `null` to suppress.              |
| `scrubbing`      | `{ enabled?: boolean; extraPatterns?: RegExp[] }` | enabled  | PII redaction in messages and URLs.                                   |
| `transport`      | `{ fetch?: typeof fetch; maxRetries?: number }`   | global   | Inject a custom fetch (testing) or bump retry budget.                 |
| `integrations`   | `string[]`                                        | none     | Free-form tags consumed by platform packages, ignored by core.        |
| `debug`          | `boolean`                                         | `false`  | Log every send to console — never enable in production.               |

`ClientDeps`:

| Field        | Type              | Notes                                                           |
| ------------ | ----------------- | --------------------------------------------------------------- |
| `adapter`    | `PlatformAdapter` | Names the SDK + enriches events with platform-only fields.      |
| `parseStack` | `StackParser`     | Converts raw `Error.stack` into structured frames.              |
| `scopeStore` | `ScopeStore?`     | Optional per-request scope. Defaults to a shared `GlobalScope`. |

### Capture

```ts
client.captureException(error, hint?): string  // returns event id
client.captureMessage(message, level?): string
client.addBreadcrumb({ category, message, level, data? })
```

`captureException` accepts non-`Error` values too — strings, plain objects, even symbols
get wrapped synthetically so callers don't have to coerce upstream.

### Scope mutation

```ts
client.setUser({ id, email?, username? })
client.setTag('region', 'eu-west')
client.setContext('order', { id: 42, total_cents: 9900 })
```

These mutate the underlying `ScopeStore`. With the default `GlobalScope` they're sticky
for the lifetime of the process — good enough for browsers and CLI tools. Server SDKs
swap in a request-scoped store so concurrent requests don't bleed user contexts.

### Lifecycle

```ts
await client.flush();
```

Drains the in-flight send queue. Call before the process exits — short-lived scripts and
serverless handlers will exit before the transport finishes its background sends
otherwise.

### Underlying data flow

```
captureException / captureMessage
  → scrubber                 (PII redaction)
  → adapter.enrichEvent      (platform metadata)
  → beforeSend               (caller hook)
  → transport.send           (POST to ingestUrl, retry on 5xx with exponential backoff)
```

Sample-rate is applied **before** scrubbing so the cost of redaction only hits events
that will actually ship.

## DSN format

```
arguslog://<publicKey>@<host>/api/<projectId>
```

`parseDsn(raw)` returns:

```ts
{
  publicKey: string;
  host: string;
  protocol: 'http' | 'https'; // http only on localhost; https everywhere else
  projectId: string;
  ingestUrl: string; // fully resolved POST target
}
```

Malformed input throws `InvalidDsnError`. The `publicKey` is project-scoped and safe to
embed in public bundles.

## Source

The full implementation lives in the [arguslog monorepo](https://github.com/petarnenov/arguslog)
at `packages/sdk-core/`. Every platform package in that workspace is a worked example of
how to consume `sdk-core` cleanly. PRs welcome.
