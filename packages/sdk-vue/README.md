# @arguslog/sdk-vue

[![npm version](https://img.shields.io/npm/v/@arguslog/sdk-vue.svg)](https://www.npmjs.com/package/@arguslog/sdk-vue)
[![license](https://img.shields.io/npm/l/@arguslog/sdk-vue.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

Vue 3 SDK for [Arguslog](https://arguslog.org) — a multi-tenant error tracking platform.
Ships a Vue plugin that initialises the underlying browser SDK, hooks into
`app.config.errorHandler` to capture component errors automatically, and exposes a
`useArguslog()` composable plus an `ArguslogErrorBoundary` component for opt-in
boundary-style capture.

Ships ESM only. Built on `@arguslog/sdk-browser`. Vue 3.3+ is the only peer dependency.

## Install

```bash
pnpm add @arguslog/sdk-vue
# or
npm install @arguslog/sdk-vue
# or
yarn add @arguslog/sdk-vue
```

## Quick start

```ts
import { createApp } from 'vue';
import { createArguslog } from '@arguslog/sdk-vue';

import App from './App.vue';

createApp(App)
  .use(
    createArguslog({
      dsn: 'arguslog://<key>@<host>/api/<projectId>',
      release: '1.0.0',
      environment: 'production',
      integrations: ['globalHandlers', 'autoBreadcrumbs'],
    }),
  )
  .mount('#app');
```

`createArguslog()` does three things:

1. Initialises `@arguslog/sdk-browser` with the supplied options.
2. Replaces `app.config.errorHandler` (chaining onto the previous one) so uncaught
   component errors are captured automatically — see **Automatic error capture**.
3. Provides an `ArguslogService` instance for `useArguslog()` consumers.

## DSN format

```
arguslog://<publicKey>@<host>/api/<projectId>
```

The `publicKey` is project-scoped and safe to embed in the bundled SPA. Get it from your
Arguslog project settings page.

## Capturing events from components

```vue
<script setup lang="ts">
import { useArguslog } from '@arguslog/sdk-vue';

const arguslog = useArguslog();

async function checkout() {
  try {
    await charge();
  } catch (err) {
    arguslog.captureException(err, {
      level: 'error',
      tags: { feature: 'checkout' },
    });
  }
}

function onLogin(user: { id: string; email: string }) {
  arguslog.setUser(user); // email auto-scrubbed
  arguslog.setTag('plan', 'pro');
}
</script>
```

`useArguslog()` returns an `ArguslogService` instance. When called outside of a Vue
component context (or before the plugin has been installed), it falls back to a fresh
service that proxies to the underlying SDK singleton — meaning you can call it from
plain `.ts` modules without dancing around setup-context errors.

The service exposes the full capture surface:

| Method                      | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `captureException(err, h?)` | Reports a thrown value with optional level/tags.  |
| `captureMessage(msg, lvl?)` | Sends a string event — useful for warnings.       |
| `setUser(user)`             | Stamps subsequent events with the user.           |
| `setTag(key, value)`        | Single-key tag mutation.                          |
| `setContext(name, ctx)`     | Free-form structured context (e.g. `order` data). |
| `addBreadcrumb(crumb)`      | Manually push a breadcrumb (router, …).           |
| `flush()`                   | Drain the send queue. Returns a `Promise<void>`.  |
| `isInitialized()`           | `true` once `init` has run successfully.          |

## Automatic error capture

By default, `createArguslog()` chains a handler onto `app.config.errorHandler` so any
uncaught error inside a component, lifecycle hook, watcher, or template expression is
forwarded to `captureException`. Events are tagged `framework: 'vue'` and carry Vue's
`info` string (e.g. `"render"`, `"setup function"`) under the `vueInfo` tag.

If you maintain your own handler chain and don't want the automatic install, opt out:

```ts
createApp(App).use(
  createArguslog({
    dsn,
    attachErrorHandler: false, // we'll wire it ourselves
  }),
);
```

…and use the standalone helper:

```ts
import { vueErrorHandler } from '@arguslog/sdk-vue';

app.config.errorHandler = (err, instance, info) => {
  vueErrorHandler(err, instance, info); // Arguslog
  myAnalytics.report(err, info); // your own
};
```

## ErrorBoundary component

For UI surfaces where you want to **render a fallback** instead of letting the error
propagate, `ArguslogErrorBoundary` captures and recovers:

```vue
<script setup lang="ts">
import { ArguslogErrorBoundary } from '@arguslog/sdk-vue';
import RiskyWidget from './RiskyWidget.vue';
</script>

<template>
  <ArguslogErrorBoundary>
    <template #default>
      <RiskyWidget />
    </template>
    <template #fallback="{ error, reset }">
      <div class="error-state">
        <p>Something went wrong. We've been notified.</p>
        <button @click="reset">Try again</button>
      </div>
    </template>
  </ArguslogErrorBoundary>
</template>
```

The error is captured before the fallback renders. `reset()` re-mounts the default slot,
so transient failures (a flapping API) recover without a full page reload.

## Router breadcrumbs

```ts
import { createRouter } from 'vue-router';
import { useArguslog } from '@arguslog/sdk-vue';

const router = createRouter({
  /* … */
});

router.afterEach((to) => {
  useArguslog().addBreadcrumb({
    category: 'navigation',
    message: to.fullPath,
    level: 'info',
  });
});
```

A captured exception now carries the route the user was on as a breadcrumb — usually the
most useful single signal during triage.

## Pinia store breadcrumbs

```ts
import { setActivePinia } from 'pinia';
import { useArguslog } from '@arguslog/sdk-vue';

pinia.use(({ store }) => {
  store.$onAction(({ name, args }) => {
    useArguslog().addBreadcrumb({
      category: 'state',
      message: `${store.$id}.${name}`,
      level: 'info',
      data: { args },
    });
  });
});
```

## Options

`createArguslog(options)` accepts the same `ArguslogOptions` as `@arguslog/sdk-browser`,
plus one Vue-specific switch:

| Option               | Type                                                                                               | Default      | Notes                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsn`                | `string`                                                                                           | _required_   | See "DSN format" above.                                                                                                                                                                                                                                 |
| `release`            | `string`                                                                                           | _none_       | Free-form version tag stamped on every event.                                                                                                                                                                                                           |
| `environment`        | `string`                                                                                           | _none_       | E.g. `production`, `staging`, `dev`.                                                                                                                                                                                                                    |
| `sampleRate`         | `number` 0–1                                                                                       | `1.0`        | Fraction of events kept; useful for high-traffic apps.                                                                                                                                                                                                  |
| `maxBreadcrumbs`     | `number`                                                                                           | `50`         | Ring-buffer size.                                                                                                                                                                                                                                       |
| `beforeSend`         | `(event) => event \| null \| Promise<...>`                                                         | _identity_   | Last-mile mutation / drop hook.                                                                                                                                                                                                                         |
| `scrubbing`          | `{ enabled?: boolean; extraPatterns?: RegExp[] }`                                                  | enabled      | PII redaction in messages and URLs.                                                                                                                                                                                                                     |
| `transport`          | `{ fetch?: typeof fetch; maxRetries?: number }`                                                    | global fetch | Inject a custom fetch (testing) or bump retry budget.                                                                                                                                                                                                   |
| `integrations`       | `('globalHandlers' \| 'console' \| 'fetch' \| 'xhr' \| 'history' \| 'dom' \| 'autoBreadcrumbs')[]` | _none_       | Opt in to auto-instrumentation in the underlying browser SDK. `'autoBreadcrumbs'` is a meta-flag — see the [`@arguslog/sdk-browser` README](https://github.com/petarnenov/arguslog/tree/main/packages/sdk-browser#integrations) for details on each ID. |
| `debug`              | `boolean`                                                                                          | `false`      | Logs every send to console — never enable in production.                                                                                                                                                                                                |
| `attachErrorHandler` | `boolean`                                                                                          | `true`       | Whether to chain onto `app.config.errorHandler`. Vue-only.                                                                                                                                                                                              |

## Nuxt 3

The plugin works in Nuxt 3 too — register it as a client-side plugin so it doesn't try to
bind to `app.config.errorHandler` on the server (the SDK itself is a server no-op, but
binding the handler is wasted work):

```ts
// plugins/arguslog.client.ts
import { createArguslog } from '@arguslog/sdk-vue';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(
    createArguslog({
      dsn: useRuntimeConfig().public.arguslogDsn,
      release: useRuntimeConfig().public.release,
      environment: process.env.NODE_ENV,
    }),
  );
});
```

For server-side error tracking, install
[`@arguslog/sdk-node`](https://www.npmjs.com/package/@arguslog/sdk-node) and use its
`integrations: ['processHandlers']` for nitro server crashes.

## Troubleshooting

**Events not appearing on the dashboard.**
Check the browser DevTools network tab — the SDK POSTs to your DSN's host. A blocked
request usually means a corporate firewall, a CSP that doesn't allow the ingest origin,
or a typo in the DSN. Set `debug: true` to log blocking failures to the console.

**Stack traces show minified frames.**
Upload sourcemaps for the release using
[`@arguslog/cli`](https://www.npmjs.com/package/@arguslog/cli):

```bash
arguslog releases new 1.0.0 --project 42
arguslog sourcemaps upload dist/assets/index.abc123.js.map \
  --project 42 --release "$RELEASE_ID" --name dist/assets/index.js
```

The `release` you pass to `createArguslog()` must match the `<version>` you pass to
`releases new` — exact string match.

**`useArguslog is not a function` after upgrade.**
You're importing from a stale type-cached path. Restart your IDE's TS server and
re-run `pnpm install`. The symbol is `export { useArguslog } from '@arguslog/sdk-vue'`
across all 1.x.

**Errors fire twice for the same exception.**
You're already chaining a custom `app.config.errorHandler` and the plugin is _also_
attaching one. Pass `attachErrorHandler: false` and call `vueErrorHandler` from your own
chain.

## Source

The full implementation lives in the [arguslog monorepo](https://github.com/petarnenov/arguslog)
at `packages/sdk-vue/`. Issues and PRs welcome.
