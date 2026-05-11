# @arguslog/sdk-browser

[![npm version](https://img.shields.io/npm/v/@arguslog/sdk-browser.svg)](https://www.npmjs.com/package/@arguslog/sdk-browser)
[![license](https://img.shields.io/npm/l/@arguslog/sdk-browser.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

Browser SDK for [Arguslog](https://arguslog.org) — a multi-tenant error tracking platform.
Captures unhandled exceptions, promise rejections, and manually-reported errors from any
JavaScript app, then ships them to the Arguslog ingest endpoint where they're fingerprinted,
stored, and surfaced on the dashboard.

Ships ESM only. Tested against modern browsers and TypeScript 5.x. No runtime dependencies.

## Install

```bash
pnpm add @arguslog/sdk-browser
# or
npm install @arguslog/sdk-browser
# or
yarn add @arguslog/sdk-browser
```

## Quick start

Initialize once at the top of your app — typically in `main.ts` or wherever your bootstrap
lives. The SDK is a no-op until `init` runs, so it's safe to import in modules that load
before bootstrap.

```ts
import { init } from '@arguslog/sdk-browser';

init({
  dsn: 'arguslog://<publicKey>@<ingestHost>/api/<projectId>',
  environment: 'production',
  release: '1.4.0',
  integrations: ['globalHandlers', 'autoBreadcrumbs'],
});
```

After `init`, unhandled `window.onerror` and `unhandledrejection` events are captured
automatically (when the `globalHandlers` integration is enabled). The
`autoBreadcrumbs` flag turns on every breadcrumb integration the SDK ships
(`console`, `fetch`, `xhr`, `history`, `dom`, `resourceErrors`, `webVitals`,
`longTasks`, `visibility`, `workerErrors`) so the dashboard timeline carries the
trail of clicks, network calls (including 4xx/5xx response body previews), route
changes, resource load failures, Core Web Vitals, main-thread freezes, page
visibility transitions and worker errors leading up to the exception. Every event
also picks up an auto-context bag with viewport, online status, locale, timezone,
color scheme and effective connection type. Manual reporting is always available
via `captureException` / `captureMessage`.

## DSN format

```
arguslog://<publicKey>@<ingestHost>/api/<projectId>
```

Get yours from your Arguslog project settings page. The `publicKey` is safe to embed in a
public bundle — it's a project-scoped token, not a secret. Ingest authenticates the request
against the project ID + key combo and rejects unknown pairs with HTTP 401.

## API

### `init(options): ArguslogClient`

Configures and starts the client. Re-initializing tears down the previous handlers cleanly,
so hot-reload during dev doesn't accumulate stale listeners.

| Option           | Type                                              | Default      | Notes                                                                 |
| ---------------- | ------------------------------------------------- | ------------ | --------------------------------------------------------------------- |
| `dsn`            | `string`                                          | _required_   | See "DSN format" above.                                               |
| `release`        | `string`                                          | _none_       | Free-form version tag — git sha, semver, etc. Stamped on every event. |
| `environment`    | `string`                                          | _none_       | E.g. `production`, `staging`, `dev`.                                  |
| `sampleRate`     | `number` 0–1                                      | `1.0`        | Fraction of events kept; useful for high-traffic apps.                |
| `maxBreadcrumbs` | `number`                                          | `50`         | Ring-buffer size.                                                     |
| `beforeSend`     | `(event) => event \| null \| Promise<...>`        | _identity_   | Last-mile mutation / drop hook.                                       |
| `scrubbing`      | `{ enabled?: boolean; extraPatterns?: RegExp[] }` | enabled      | PII redaction in messages and URLs.                                   |
| `transport`      | `{ fetch?: typeof fetch; maxRetries?: number }`   | global fetch | Inject a custom fetch (testing) or bump retry budget.                 |
| `integrations`   | `IntegrationId[]` (see below)                     | _none_       | Opt in to auto-instrumentation. `'autoBreadcrumbs'` is a meta-flag that turns on every breadcrumb integration. |
| `debug`          | `boolean`                                         | `false`      | Logs every send to the console — never enable in production.          |

### `captureException(error, hint?): string | undefined`

Reports a thrown value. Returns the generated event id, or `undefined` if the SDK isn't
initialized. The `hint` lets you tag the event without mutating client-wide state.

```ts
import { captureException } from '@arguslog/sdk-browser';

try {
  riskyThing();
} catch (err) {
  captureException(err, { level: 'error', tags: { feature: 'checkout' } });
}
```

Non-Error values (strings, plain objects, symbols) are wrapped synthetically so you don't
have to coerce upstream.

### `captureMessage(message, level?): string | undefined`

Sends a string event without a stack trace. Useful for breadcrumb-level signals.

```ts
captureMessage('Cart abandoned at step 3', 'warning');
```

### `setUser(user | undefined)`

Attaches user identity to subsequent events. Pass `undefined` to clear (e.g. on logout).

```ts
setUser({ id: '42', email: 'jane@example.com' });
// later
setUser(undefined);
```

### `setTag(key, value)` / `setContext(name, ctx)`

`setTag` adds a single key/value to every event going forward; `setContext` attaches an
arbitrary object under a named bucket (think "request", "feature flags", etc.).

### `addBreadcrumb(crumb)`

Records a navigation / click / network / custom event. The last `maxBreadcrumbs` are attached
to every captured exception, so debugging gets the trail leading up to the error.

```ts
addBreadcrumb({
  category: 'navigation',
  message: 'User clicked Buy',
  level: 'info',
  data: { sku: 'A-123' },
});
```

### `flush(): Promise<void>`

Awaits the in-flight queue. Useful before `window.unload` or in service workers.

## Integrations

Every integration is opt-in via the `integrations` array, returns a no-op when `window` is
not defined (SSR), and installs an uninstaller that runs on the next `init` so hot-reload
during dev never accumulates duplicate listeners. Pass `'autoBreadcrumbs'` to turn on every
breadcrumb integration in one go, or list them individually.

```ts
init({
  dsn: '...',
  integrations: [
    'globalHandlers',
    'autoBreadcrumbs',
    // …or pick à la carte:
    // 'console', 'fetch', 'xhr', 'history', 'dom',
    // 'resourceErrors', 'webVitals',
    // 'longTasks', 'visibility', 'workerErrors',
  ],
});
```

| ID                | Captures                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `globalHandlers`  | `window.onerror` + `unhandledrejection`. The "actual error capture" integration — without it nothing reaches `captureException` automatically. |
| `console`         | Every `console.log/info/warn/error/debug` becomes a breadcrumb. The original console call is preserved. Levels map to `info/info/warning/error/debug`. |
| `fetch`           | Patches `window.fetch`. Every request leaves a breadcrumb with method, URL, status, duration. 2xx → info, 4xx → warning, 5xx → error. Network failures are recorded and re-thrown. **For 4xx/5xx with a JSON / text content type**, the first 4KB of the response body is captured into `data.responsePreview` so error messages from your own backend show up next to the status. Body is read via `response.clone()` so user code's `await response.json()` still works. |
| `xhr`             | Same payload shape as `fetch` but for legacy `XMLHttpRequest` traffic (jQuery AJAX, axios's xhr adapter, hand-rolled XHR). Same 4KB response preview on 4xx/5xx when `responseType` is `''` or `'text'`. |
| `history`         | Patches `history.pushState` / `replaceState` and listens for `popstate` / `hashchange`. Single-page-app routers leave a navigation trail (`/start → /billing`). |
| `resourceErrors`  | `<img>`, `<script>`, `<link>`, `<audio>`, `<video>`, `<iframe>` load failures. These never reach `window.onerror` — common cause of "image silently missing" / "ad blocker killed third-party script" bugs. |
| `webVitals`       | Core Web Vitals as breadcrumbs (LCP / INP / CLS / FCP / TTFB) via the [`web-vitals`](https://github.com/GoogleChrome/web-vitals) library. Poor ratings show as `warning` so a slow LCP next to a crash is visible at a glance. |
| `dom`             | Document-level capture-phase listeners for `click` and `submit`. Only interactive targets are recorded (`<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, `<label>`, `[role=button \| link \| checkbox \| menuitem]`, `[data-arguslog-track]`). The closest interactive ancestor of the click target is used so a click on a `<span>` inside a `<button>` reports the button. |
| `longTasks`       | `PerformanceObserver` for `longtask` entries — main thread blocked >50ms. 50–200ms → info, 200–500ms → warning, 500ms+ → error. Reveals "the UI froze right before the click stopped responding" patterns. Source attribution (`containerType` / `containerSrc`) is included where Chromium supplies it. |
| `visibility`      | `visibilitychange`, `pagehide`, `online`, `offline` events. Distinguishes "error fired while user was on another tab" from "error fired during interaction" — different debugging stories. |
| `workerErrors`    | Forwards Web Worker + Service Worker errors into the main-thread client. Patches the global `Worker` constructor to attach an `error` listener on every new instance; service workers can also opt in by `postMessage({ __arguslog: 'error', message, stack })`. |
| `autoBreadcrumbs` | Convenience meta-flag — turns on every breadcrumb integration (`console`, `fetch`, `xhr`, `history`, `dom`, `resourceErrors`, `webVitals`, `longTasks`, `visibility`, `workerErrors`). |

### Customizing the DOM breadcrumb label

The `dom` integration auto-derives a label like `button#pay.primary "Pay"`. Override with
`data-arguslog-label` on any tracked element:

```html
<button data-arguslog-label="Upgrade to Pro — annual">Upgrade <span>(save 33%)</span></button>
```

The breadcrumb message becomes exactly `Upgrade to Pro — annual` instead of an auto-derived
selector.

## Privacy / scrubbing

Built-in regex patterns redact common PII (emails, IPs, US-style SSNs, JWT-ish tokens) from
message strings and URLs before send. Add custom patterns via
`scrubbing.extraPatterns: [/\bUSR-\d+\b/]`. Disable entirely with `scrubbing.enabled: false`
when you control the input shape and want full fidelity.

## React?

Use [`@arguslog/sdk-react`](https://www.npmjs.com/package/@arguslog/sdk-react) — it
re-exports this SDK plus a `<ArguslogErrorBoundary>` and `useArguslog()` hook.

## License

MIT — see [LICENSE](https://github.com/petarnenov/arguslog/blob/main/LICENSE).
