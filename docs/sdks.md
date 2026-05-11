# Arguslog SDKs

Quick install + first-event snippets for every shipped SDK. Source for
each lives under the path listed in the table; the marketing landing
page and the dashboard's project-create dropdown both render the same
catalog from `/api/v1/platforms`.

A DSN is generated when you create a project — the Copy DSN modal in
the dashboard shows the exact value. Format:

```
arguslog://<publicKey>@<host>/api/<projectId>
```

The wire format is identical across SDKs, so events from a polyglot
stack (Next.js front-end + Spring Boot API + Python worker) collapse
into the same Arguslog issue groups by stack-frame fingerprint.

---

## Browser (vanilla JS/TS)

```bash
pnpm add @arguslog/sdk-browser
```

```ts
import { init, captureException } from '@arguslog/sdk-browser';

init({
  dsn: import.meta.env.VITE_ARGUSLOG_DSN,
  release: import.meta.env.VITE_RELEASE,
  integrations: ['globalHandlers'],
});

window.addEventListener('error', (e) => captureException(e.error));
```

## React

```bash
pnpm add @arguslog/sdk-react
```

```tsx
import { ArguslogErrorBoundary, init } from '@arguslog/sdk-react';

init({ dsn: import.meta.env.VITE_ARGUSLOG_DSN });

export function App() {
  return (
    <ArguslogErrorBoundary fallback={<p>Something broke.</p>}>
      <Routes />
    </ArguslogErrorBoundary>
  );
}
```

## Next.js

```bash
pnpm add @arguslog/sdk-nextjs
```

```ts
// instrumentation.ts
import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@arguslog/sdk-nextjs/server');
    init({ dsn: process.env.ARGUSLOG_DSN!, integrations: ['processHandlers'] });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { onRequestError } = await import('@arguslog/sdk-nextjs/server');
  return onRequestError(err, request, context);
};
```

## Angular

```bash
pnpm add @arguslog/sdk-angular
```

```ts
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideArguslog } from '@arguslog/sdk-angular';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideArguslog({
      dsn: 'arguslog://<key>@<host>/api/<projectId>',
      integrations: ['globalHandlers'],
    }),
  ],
});
```

`provideArguslog` registers an `ErrorHandler` that auto-captures
uncaught Angular errors. NgModule consumers can use
`ArguslogModule.forRoot(options)` instead.

## Vue 3

```bash
pnpm add @arguslog/sdk-vue
```

```ts
// main.ts
import { createApp } from 'vue';
import { createArguslog } from '@arguslog/sdk-vue';
import App from './App.vue';

createApp(App)
  .use(
    createArguslog({
      dsn: 'arguslog://<key>@<host>/api/<projectId>',
      integrations: ['globalHandlers'],
    }),
  )
  .mount('#app');
```

`createArguslog()` runs `init()`, replaces `app.config.errorHandler`
with a chain that forwards uncaught component errors to
`captureException`, and provides an `ArguslogService` for the
`useArguslog()` composable. Wrap subtrees in
`<ArguslogErrorBoundary fallback="…">` to catch render and lifecycle
errors locally.

## React Native

```bash
pnpm add @arguslog/sdk-react-native
```

```tsx
import { init, ArguslogErrorBoundary } from '@arguslog/sdk-react-native';

init({ dsn: '<DSN>', integrations: ['globalHandlers'] });

export default function App() {
  return (
    <ArguslogErrorBoundary fallback={<Text>Crashed</Text>}>
      <Root />
    </ArguslogErrorBoundary>
  );
}
```

## Node.js

```bash
pnpm add @arguslog/sdk-node
```

```ts
import { init, captureException, flush } from '@arguslog/sdk-node';

init({
  dsn: process.env.ARGUSLOG_DSN!,
  release: process.env.npm_package_version,
  integrations: ['processHandlers', 'http'],
  sourcemaps: { enabled: true },
});

try {
  await runJob();
} catch (err) {
  captureException(err, { tags: { job: 'nightly-rollup' } });
  throw err;
} finally {
  // CRITICAL for short-lived processes: the background sender drains here.
  await flush();
}
```

The `sdk-node/express` subpath ships a request middleware:

```ts
import express from 'express';
import { argusErrorHandler } from '@arguslog/sdk-node/express';

const app = express();
app.use(argusErrorHandler());
```

## Java / Spring Boot

```kotlin
// build.gradle.kts
implementation("org.arguslog:arguslog-java-sdk:1.0.0")
```

```yaml
# application.yml
arguslog:
  dsn: ${ARGUSLOG_DSN}
  environment: ${SPRING_PROFILES_ACTIVE:default}
  release: ${BUILD_VERSION:dev}
```

The autoconfiguration wires:

- a global `@ControllerAdvice` that captures `5xx`-mapping exceptions
- a Logback appender that forwards `ERROR`-level events with throwables
- an `Arguslog.captureException(...)` static facade for hand-rolled
  capture inside services / batch jobs

## Python 3.9+

```bash
pip install arguslog
```

```python
import arguslog

arguslog.init(
    "arguslog://<key>@<host>/api/<projectId>",
    environment="production",
    release="1.2.3",
)

try:
    do_something_risky()
except Exception as exc:
    arguslog.capture_exception(exc, tags={"flow": "checkout"})

arguslog.flush()  # required for short-lived scripts / CLIs
```

Two opt-in integrations live under `arguslog.integrations`:

```python
from arguslog.integrations.excepthook import install_excepthook
from arguslog.integrations.logging import install_logging_handler

install_excepthook(arguslog.get_client())
install_logging_handler(arguslog.get_client())
```

## Web3 add-on (EVM + Solana)

```bash
pnpm add @arguslog/sdk-web3
```

`sdk-web3` layers on top of `@arguslog/sdk-browser` and turns generic
"Transaction failed" errors into rich Arguslog issues with chain,
wallet, contract / program, function / instruction, args, and the
decoded revert reason / Anchor error / custom program error.

### Wire everything in one call

`initWeb3` accepts every input the SDK supports and returns each one
wrapped. Pass whatever your app actually has — anything you omit is
skipped, so the same call works for an EVM-only app, a Solana-only
app, or a hybrid:

```ts
import { init } from '@arguslog/sdk-browser';
import { initWeb3 } from '@arguslog/sdk-web3';
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Contract } from 'ethers';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';

init({ dsn: import.meta.env.VITE_ARGUSLOG_DSN, integrations: ['globalHandlers', 'autoBreadcrumbs'] });

const {
  walletClient,     // viem WalletClient — write methods auto-captured
  publicClient,     // viem PublicClient — read failures auto-captured
  ethersContracts,  // [Contract, ...] — every method auto-captured
  solanaConnection, // @solana/web3.js Connection — sendTx/sim/confirm auto-captured
  anchorPrograms,   // [Program, ...] — every methods.X.rpc/.simulate auto-captured
  uninstall,
} = initWeb3({
  provider: window.ethereum,
  walletClient: createWalletClient({ chain: mainnet, transport: custom(window.ethereum) }),
  publicClient: createPublicClient({ chain: mainnet, transport: http() }),
  ethersContracts: [erc20Contract, ammContract],
  solanaConnection: new Connection(clusterApiUrl('mainnet-beta')),
  solanaWallet: phantomAdapter,
  anchorPrograms: [swapProgram],
  queryClient,                                          // wagmi mutation reporter
  wrapOptions: { chain: { id: 1, name: 'Ethereum' } },
});
```

`uninstall()` tears down every listener installed in this call —
call it on hot-reload or on user logout. Every wrapped client also
emits info-level breadcrumbs on the success path
(`web3.tx`, `web3.sign`, `web3.simulate`, `web3.confirm`,
`web3.switch`) so the issue timeline reads as a coherent story
leading up to whatever finally fails.

### What's covered

| Layer                        | Source                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| EIP-1193 provider events     | `accountsChanged`, `chainChanged`, `connect`, `disconnect` → breadcrumbs                                     |
| WalletConnect v2 lifecycle   | `display_uri`, `session_event/update/delete/expire`, `session_request*`, `session_authenticate` → breadcrumbs |
| viem `WalletClient`          | `writeContract`, `sendTransaction`, `signMessage`, `signTypedData`, `signTransaction`, `deployContract`, … |
| viem `PublicClient`          | `readContract`, `simulateContract`, `estimateGas`, `estimateContractGas`, `call`, `waitForTransactionReceipt` |
| ethers v6 `Contract`         | every method (ERC20 reads `balanceOf`/`decimals`/… skipped by default)                                       |
| `@solana/web3.js Connection` | `sendTransaction`, `sendRawTransaction`, `simulateTransaction`, `confirmTransaction`                         |
| `@coral-xyz/anchor` programs | `methods.X.rpc()` / `.simulate()` / `.transaction()` chained calls                                           |
| `@solana/wallet-adapter-base`| `connect`, `disconnect`, `error`, `readyStateChange`                                                         |
| wagmi v2 mutations           | `writeContract`, `sendTransaction`, `signMessage`, `signTypedData`, `switchChain`, `connect`, `disconnect`   |

Errors are decoded in this order: **viem** typed errors → **ethers v6**
`.code` field → **Solana** (Anchor / wallet adapter / log parser) →
generic `Error.message`. Whatever the decoder extracts goes onto the
captured event as **searchable tags** (`web3.kind`, `web3.chain`,
`web3.wallet`, `web3.contract`) and as a structured **breadcrumb**.

### Manual capture

When you can't / don't want to wrap a client, capture errors yourself:

```ts
import { captureWeb3Error } from '@arguslog/sdk-web3';

try {
  await contract.transfer(recipient, amount);
} catch (err) {
  captureWeb3Error(err, {
    chain: { id: 1, name: 'Ethereum mainnet' },
    wallet: 'metamask',
    contract: contract.target as string,
    functionName: 'transfer',
    args: [recipient, amount],
  });
  throw err;
}
```

Full reference: [`packages/sdk-web3/README.md`](../packages/sdk-web3/README.md).

---

## Lifecycle notes

- **Always `flush()` before a short-lived process exits.** CLIs, cron
  jobs, and serverless functions terminate faster than the background
  sender's first request leaves the socket. Long-running servers can
  rely on the sender thread.
- **Source maps & symbolication.** The CLI (`@arguslog/cli`) uploads
  source maps per release; symbolication runs in the worker so the
  dashboard shows real file paths instead of minified bundle frames.
- **PII scrubbing is on by default** in every SDK. Email, JWT-shaped
  tokens, and credit-card-shaped digit runs are redacted before the
  payload leaves the host. The pattern set is identical across the
  JS / Java / Python implementations.
