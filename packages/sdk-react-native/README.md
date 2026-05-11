# @arguslog/sdk-react-native

[![npm version](https://img.shields.io/npm/v/@arguslog/sdk-react-native.svg)](https://www.npmjs.com/package/@arguslog/sdk-react-native)
[![license](https://img.shields.io/npm/l/@arguslog/sdk-react-native.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

React Native SDK for [Arguslog](https://arguslog.org). Wraps `@arguslog/sdk-browser` with a
RN-native global error handler (via `ErrorUtils`), an `<ArguslogErrorBoundary>`, a
`useArguslog()` hook, and an opt-in AppState breadcrumb integration.

Ships ESM only. Compatible with React Native 0.73+ on Hermes or JSC, and React 18 / 19.

## Install

```bash
pnpm add @arguslog/sdk-react-native
# peer deps — already in any RN app
pnpm add react react-native
```

## Quick start

```tsx
import { init, ArguslogErrorBoundary } from '@arguslog/sdk-react-native';
import { AppRegistry } from 'react-native';

init({
  dsn: 'arguslog://<publicKey>@<host>/api/<projectId>',
  environment: __DEV__ ? 'dev' : 'production',
  release: '1.4.0',
  integrations: ['globalHandlers'],
});

function App() {
  return (
    <ArguslogErrorBoundary fallback={<CrashScreen />}>
      <RootStack />
    </ArguslogErrorBoundary>
  );
}

AppRegistry.registerComponent('MyApp', () => App);
```

## What `globalHandlers` does on RN

- Wires `ErrorUtils.setGlobalHandler` and chains the previous handler so RN's redbox /
  LogBox still fires in dev. Fatal flag is forwarded as `level: 'fatal'`.
- If `globalThis.addEventListener` is available (Hermes ≥ 0.74), also picks up
  `unhandledrejection` events. On older runtimes you can wire
  `promise/setimmediate/rejection-tracking` yourself and forward into `captureException`.

## AppState breadcrumbs (opt-in)

`AppState` isn't statically imported by this package — that keeps the module loadable in
test environments that don't resolve `react-native`. Pass it in explicitly:

```ts
import { AppState } from 'react-native';
import { installAppStateBreadcrumbs } from '@arguslog/sdk-react-native';

const teardown = installAppStateBreadcrumbs(AppState);
// later, on app shutdown:
teardown();
```

Each foreground/background transition becomes a breadcrumb under the `app.lifecycle`
category, which is then attached to subsequent captured exceptions.

## Day 1 breadcrumbs setup

A pragmatic bootstrap that wires the four breadcrumb sources most apps want from the
moment they ship: app lifecycle, navigation, fetch, and `console.warn` / `console.error`.
Drop this in a single `arguslog.ts` file and call `bootstrapArguslog()` once from your
entry point.

```ts
// src/arguslog.ts
import {
  addBreadcrumb,
  captureException,
  init,
  installAppStateBreadcrumbs,
} from '@arguslog/sdk-react-native';
import { AppState, Platform } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';

export function bootstrapArguslog(): void {
  init({
    dsn: 'arguslog://<publicKey>@<host>/api/<projectId>',
    environment: __DEV__ ? 'dev' : 'production',
    release: `myapp@1.4.0+${Platform.OS}`,
    integrations: ['globalHandlers'],
    maxBreadcrumbs: 100,
  });

  installAppStateBreadcrumbs(AppState);
  installFetchBreadcrumbs();
  installConsoleBreadcrumbs();
}

// 1) Network — wraps global fetch and records method, URL, status, duration.
function installFetchBreadcrumbs(): void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const started = Date.now();
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : (input as Request).url;
    try {
      const res = await original(input as RequestInfo, init);
      addBreadcrumb({
        category: 'http',
        message: `${method} ${url}`,
        level: res.ok ? 'info' : 'warning',
        data: { status: res.status, duration_ms: Date.now() - started },
      });
      return res;
    } catch (err) {
      addBreadcrumb({
        category: 'http',
        message: `${method} ${url}`,
        level: 'error',
        data: { error: String(err), duration_ms: Date.now() - started },
      });
      throw err;
    }
  };
}

// 2) Console — surfaces dev warnings/errors as breadcrumbs without changing call sites.
function installConsoleBreadcrumbs(): void {
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      addBreadcrumb({
        category: 'console',
        message: args.map(String).join(' ').slice(0, 200),
        level: level === 'error' ? 'error' : 'warning',
      });
      original(...args);
    };
  }
}

// 3) Navigation — record screen transitions. Pass the NavigationContainer ref in.
//    Call `attachNavigationBreadcrumbs(navigationRef)` from <NavigationContainer ref=...>.
export function attachNavigationBreadcrumbs(
  navigationRef: NavigationContainerRef<Record<string, object | undefined>>,
): void {
  let previous: string | undefined;
  navigationRef.addListener('state', () => {
    const current = navigationRef.getCurrentRoute()?.name;
    if (current && current !== previous) {
      addBreadcrumb({
        category: 'navigation',
        message: previous ? `${previous} → ${current}` : current,
        level: 'info',
        data: { from: previous, to: current },
      });
      previous = current;
    }
  });
}

// Optional: catch errors that escape async boundaries you forgot to wrap.
export function reportAsync<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    captureException(err);
    throw err;
  });
}
```

Wire it into your root:

```tsx
// index.tsx
import { AppRegistry } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { bootstrapArguslog, attachNavigationBreadcrumbs } from './arguslog';

bootstrapArguslog();
const navigationRef = createNavigationContainerRef();

function Root() {
  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => attachNavigationBreadcrumbs(navigationRef)}
    >
      <RootStack />
    </NavigationContainer>
  );
}

AppRegistry.registerComponent('MyApp', () => Root);
```

After this, every captured exception arrives with the trail of: app foregrounded →
screen transitions → HTTP requests → warnings — even on the very first crash you ship.

## Common use cases

### Identifying the signed-in user

Set on login, clear on logout. The identity is attached to every subsequent event.

```ts
import { setUser } from '@arguslog/sdk-react-native';

function onLogin(account: { id: string; email: string }): void {
  setUser({ id: account.id, email: account.email });
}

function onLogout(): void {
  setUser(undefined);
}
```

### Capturing handled errors

For errors you've already caught — surface them anyway, with feature-scoped tags.

```ts
import { captureException, captureMessage } from '@arguslog/sdk-react-native';

async function checkout(cart: Cart): Promise<void> {
  try {
    await api.placeOrder(cart);
  } catch (err) {
    captureException(err, {
      level: 'error',
      tags: { feature: 'checkout', step: 'place-order' },
    });
    throw err; // still bubble to the UI layer
  }
}

// Non-error signals — useful for "shouldn't happen" branches.
if (!cart.items.length) {
  captureMessage('Empty cart reached checkout', 'warning');
}
```

### Wrapping a React event handler

The hook returns a stable surface, safe to call from event handlers.

```tsx
import { useArguslog } from '@arguslog/sdk-react-native';

function BuyButton({ sku }: { sku: string }) {
  const arguslog = useArguslog();
  return (
    <Pressable
      onPress={() => {
        arguslog.addBreadcrumb({
          category: 'ui.click',
          message: 'Buy pressed',
          level: 'info',
          data: { sku },
        });
        buy(sku).catch((err) => arguslog.captureException(err, { tags: { sku } }));
      }}
    >
      <Text>Buy</Text>
    </Pressable>
  );
}
```

### Tagging events globally

Pin a value to every event going forward — useful for A/B variant, build channel, etc.

```ts
import { setTag, setContext } from '@arguslog/sdk-react-native';

setTag('build.channel', __DEV__ ? 'debug' : 'release');
setTag('ab.checkout', 'variant-b');

setContext('device', {
  os: Platform.OS,
  version: Platform.Version,
  isHermes: Boolean((globalThis as { HermesInternal?: unknown }).HermesInternal),
});
```

### Filtering / scrubbing before send

Drop or mutate events at the last mile via `beforeSend`. Returning `null` drops the event.

```ts
init({
  dsn: '…',
  beforeSend: (event) => {
    // Drop events from a known-noisy third-party SDK.
    if (event.exception?.values[0]?.value?.includes('NoiseLib')) return null;
    // Strip auth headers from request context if some other code attached them.
    if (event.contexts?.request) {
      delete (event.contexts.request as { headers?: unknown }).headers;
    }
    return event;
  },
});
```

### Sampling in production

Keep dev fidelity at 100%, sample heavy traffic in prod.

```ts
init({
  dsn: '…',
  sampleRate: __DEV__ ? 1.0 : 0.2,
});
```

### Flush before going to background

When the OS may suspend the JS runtime mid-request, await the queue first.

```ts
import { AppState } from 'react-native';
import { flush } from '@arguslog/sdk-react-native';

AppState.addEventListener('change', async (state) => {
  if (state === 'background') {
    await flush();
  }
});
```

### Recording manual breadcrumbs

For custom signals that aren't covered by the auto-instrumentation above.

```ts
import { addBreadcrumb } from '@arguslog/sdk-react-native';

addBreadcrumb({
  category: 'auth',
  message: 'Token refreshed',
  level: 'info',
  data: { exp: token.exp },
});
```

## API

The full browser SDK surface (`captureException`, `captureMessage`, `setUser`, `setTag`,
`setContext`, `addBreadcrumb`, `flush`, `getClient`) is re-exported. See
[`@arguslog/sdk-browser`](../sdk-browser/README.md) for option details.

### `init(options): ArguslogClient`

Same options as the browser SDK, but `integrations` is narrowed to RN-supported values
(`'globalHandlers'`). Calling `init` again tears down previously installed handlers, so
hot-reload during dev doesn't accumulate listeners.

### `<ArguslogErrorBoundary fallback={...} onError={...}>`

React error boundary. Captures any child render-time error with
`tags: { boundary: 'react-native' }`, then renders `fallback` (a node or render-prop). The
render-prop receives `{ error, reset }` so you can offer a "Try again" button.

### `useArguslog()`

Memoized object exposing `captureException`, `captureMessage`, `addBreadcrumb`, `setUser`,
`setTag`, `setContext`, and `isInitialized()`. Stable across re-renders.

## License

MIT — see [LICENSE](https://github.com/petarnenov/arguslog/blob/main/LICENSE).
