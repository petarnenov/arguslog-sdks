# @arguslog/sdk-angular

[![npm version](https://img.shields.io/npm/v/@arguslog/sdk-angular.svg)](https://www.npmjs.com/package/@arguslog/sdk-angular)
[![license](https://img.shields.io/npm/l/@arguslog/sdk-angular.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

Angular SDK for [Arguslog](https://arguslog.org) — a multi-tenant error tracking platform.
Wires the [`@arguslog/sdk-browser`](https://www.npmjs.com/package/@arguslog/sdk-browser)
client into Angular's DI container, replaces the default `ErrorHandler`, and exposes an
injectable `ArguslogService` so components and services can capture events without
reaching for module-level imports.

Ships ESM only. Built on `@arguslog/sdk-browser`. Supports Angular 17+ (standalone
bootstrap and the legacy NgModule path are both wired).

## Install

```bash
pnpm add @arguslog/sdk-angular
# or
npm install @arguslog/sdk-angular
# or
yarn add @arguslog/sdk-angular
```

## Quick start (standalone bootstrap, Angular 17+)

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideArguslog } from '@arguslog/sdk-angular';

import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideArguslog({
      dsn: 'arguslog://<key>@<host>/api/<projectId>',
      release: '1.0.0',
      environment: 'production',
      integrations: ['globalHandlers', 'autoBreadcrumbs'],
    }),
  ],
});
```

`provideArguslog()` does three things in one call:

1. Initializes `@arguslog/sdk-browser` with the supplied options.
2. Replaces Angular's default `ErrorHandler` with `ArguslogErrorHandler`.
3. Exposes `ARGUSLOG_OPTIONS` and `ArguslogService` for DI consumers.

## Quick start (NgModule, Angular ≤ 16 or hybrid apps)

```ts
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ArguslogModule } from '@arguslog/sdk-angular';

import { AppComponent } from './app.component';

@NgModule({
  imports: [
    BrowserModule,
    ArguslogModule.forRoot({
      dsn: 'arguslog://<key>@<host>/api/<projectId>',
      release: '1.0.0',
      environment: 'production',
    }),
  ],
  declarations: [AppComponent],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

`ArguslogModule.forRoot()` and `provideArguslog()` register the same providers — pick
whichever matches your bootstrap style.

## DSN format

```
arguslog://<publicKey>@<host>/api/<projectId>
```

The `publicKey` is project-scoped and safe to embed in the bundled SPA. Get it from your
Arguslog project settings page.

## Capturing events from components & services

Inject `ArguslogService` anywhere — it wraps the underlying SDK so you don't have to
import top-level functions throughout your codebase.

```ts
import { Component, inject } from '@angular/core';
import { ArguslogService } from '@arguslog/sdk-angular';

@Component({
  standalone: true,
  selector: 'app-checkout',
  templateUrl: './checkout.component.html',
})
export class CheckoutComponent {
  private readonly arguslog = inject(ArguslogService);

  async pay() {
    try {
      await this.charge();
    } catch (err) {
      this.arguslog.captureException(err, {
        level: 'error',
        tags: { feature: 'checkout' },
      });
    }
  }

  setUserOnLogin(user: { id: string; email: string }) {
    this.arguslog.setUser(user); // email is auto-scrubbed
    this.arguslog.setTag('plan', 'pro');
  }
}
```

`ArguslogService` exposes the full capture surface:

| Method                      | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `captureException(err, h?)` | Reports a thrown value with optional level/tags.  |
| `captureMessage(msg, lvl?)` | Sends a string event — useful for warnings.       |
| `setUser(user)`             | Stamps subsequent events with the user.           |
| `setTag(key, value)`        | Single-key tag mutation.                          |
| `setContext(name, ctx)`     | Free-form structured context (e.g. `order` data). |
| `addBreadcrumb(crumb)`      | Manually push a breadcrumb (router events, …).    |
| `flush()`                   | Drain the send queue. Returns a `Promise<void>`.  |
| `isInitialized()`           | `true` once `init` has run successfully.          |

## Automatic error capture

`ArguslogErrorHandler` replaces Angular's default `ErrorHandler`. Anything that throws
during a Zone tick — change-detection, event handlers, lifecycle hooks, or unhandled
rejections inside an `async` handler — is captured automatically.

The handler unwraps the Zone wrapper Angular uses (`error.rejection` /
`error.originalError`) so the captured payload contains the real `Error` instance, not the
zone wrapper. Events are tagged `framework: 'angular'`.

You don't need to do anything to enable this — `provideArguslog()` /
`ArguslogModule.forRoot()` register the handler for you.

## Manual ErrorHandler composition

If you maintain your own `ErrorHandler` chain (e.g. console logging + analytics fallback)
and don't want the default replacement, you can register the providers without
`ArguslogErrorHandler`:

```ts
import { ErrorHandler, ENVIRONMENT_INITIALIZER } from '@angular/core';
import { ARGUSLOG_OPTIONS } from '@arguslog/sdk-angular';
import { init } from '@arguslog/sdk-browser';

// In your bootstrap providers:
[
  { provide: ARGUSLOG_OPTIONS, useValue: ARGUSLOG_CONFIG },
  {
    provide: ErrorHandler,
    useClass: MyChainingErrorHandler, // calls captureException internally
  },
  {
    provide: ENVIRONMENT_INITIALIZER,
    multi: true,
    useValue: () => init(ARGUSLOG_CONFIG),
  },
];
```

## Router breadcrumbs

The SDK doesn't auto-instrument the router (Angular Router's events vary too much across
versions to make a safe default), but the recipe is two lines:

```ts
import { inject, NgModule } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { ArguslogService } from '@arguslog/sdk-angular';

@NgModule({
  /* … */
})
export class AppModule {
  constructor() {
    const router = inject(Router);
    const arguslog = inject(ArguslogService);

    router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        arguslog.addBreadcrumb({
          category: 'navigation',
          message: e.urlAfterRedirects,
          level: 'info',
        });
      }
    });
  }
}
```

A captured exception now carries the route the user was on at the time as a breadcrumb,
which is usually the single most useful signal during triage.

## Options

`provideArguslog(options)` and `ArguslogModule.forRoot(options)` both accept the same
`ArguslogOptions` from `@arguslog/sdk-browser`:

| Option           | Type                                                                                               | Default      | Notes                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsn`            | `string`                                                                                           | _required_   | See "DSN format" above.                                                                                                                                                                                                                                 |
| `release`        | `string`                                                                                           | _none_       | Free-form version tag stamped on every event.                                                                                                                                                                                                           |
| `environment`    | `string`                                                                                           | _none_       | E.g. `production`, `staging`, `dev`.                                                                                                                                                                                                                    |
| `sampleRate`     | `number` 0–1                                                                                       | `1.0`        | Fraction of events kept; useful for high-traffic apps.                                                                                                                                                                                                  |
| `maxBreadcrumbs` | `number`                                                                                           | `50`         | Ring-buffer size.                                                                                                                                                                                                                                       |
| `beforeSend`     | `(event) => event \| null \| Promise<...>`                                                         | _identity_   | Last-mile mutation / drop hook.                                                                                                                                                                                                                         |
| `scrubbing`      | `{ enabled?: boolean; extraPatterns?: RegExp[] }`                                                  | enabled      | PII redaction in messages and URLs.                                                                                                                                                                                                                     |
| `transport`      | `{ fetch?: typeof fetch; maxRetries?: number }`                                                    | global fetch | Inject a custom fetch (testing) or bump retry budget.                                                                                                                                                                                                   |
| `integrations`   | `('globalHandlers' \| 'console' \| 'fetch' \| 'xhr' \| 'history' \| 'dom' \| 'autoBreadcrumbs')[]` | _none_       | Opt in to auto-instrumentation in the underlying browser SDK. `'autoBreadcrumbs'` is a meta-flag — see the [`@arguslog/sdk-browser` README](https://github.com/petarnenov/arguslog/tree/main/packages/sdk-browser#integrations) for details on each ID. |
| `debug`          | `boolean`                                                                                          | `false`      | Logs every send to console — never enable in production.                                                                                                                                                                                                |

## SSR / Angular Universal

`provideArguslog()` is safe to register at the root because the underlying browser SDK is
a no-op in environments without `window`. The `ENVIRONMENT_INITIALIZER` runs in both
server and client phases, but `init` short-circuits gracefully on the server.

If you also run a Node.js server (Express engine), pair the Angular SDK on the client
with [`@arguslog/sdk-node`](https://www.npmjs.com/package/@arguslog/sdk-node) on the
server — they ship their own DSN, release, and environment so you can route SSR errors
to a different project if you want.

## Troubleshooting

**Events not appearing on the dashboard.**
Check the browser DevTools network tab — the SDK POSTs to your DSN's host. A blocked
request usually means a corporate firewall, a content-security-policy that doesn't allow
the ingest origin, or a typo in the DSN. The SDK logs blocking failures to the console
when you set `debug: true`.

**Stack traces show minified frames.**
Upload sourcemaps for the release using
[`@arguslog/cli`](https://www.npmjs.com/package/@arguslog/cli):

```bash
arguslog releases new 1.0.0 --project 42
arguslog sourcemaps upload dist/main.abc123.js.map \
  --project 42 --release "$RELEASE_ID" --name dist/main.js
```

The `release` you pass to `provideArguslog()` must match the `<version>` you pass to
`releases new` — exact string match.

**`NullInjectorError: No provider for ArguslogService`.**
You forgot `provideArguslog()` (or `ArguslogModule.forRoot()`). The service is
`providedIn: 'root'` only after the module/providers register the options token.

**Errors fire twice for the same exception.**
You probably composed `ArguslogErrorHandler` with another handler that also rethrows.
Use the manual composition recipe above and call `captureException` once.

## Source

The full implementation lives in the [arguslog monorepo](https://github.com/petarnenov/arguslog)
at `packages/sdk-angular/`. Issues and PRs welcome.
