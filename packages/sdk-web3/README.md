# @arguslog/sdk-web3

[![npm version](https://img.shields.io/npm/v/@arguslog/sdk-web3.svg)](https://www.npmjs.com/package/@arguslog/sdk-web3)
[![license](https://img.shields.io/npm/l/@arguslog/sdk-web3.svg)](https://github.com/petarnenov/arguslog/blob/main/LICENSE)

> Sentry sees `Error: transaction failed`. Arguslog tells you **why**: the chain, the wallet,
> the contract / program, the function / instruction, the args, and the **decoded** revert
> reason. Built on top of `@arguslog/sdk-browser`. Native support for
> [viem](https://viem.sh), [ethers v6](https://docs.ethers.org/v6/),
> [@solana/web3.js](https://solana-labs.github.io/solana-web3.js/) and
> [Anchor](https://www.anchor-lang.com/).

```text
ContractFunctionRevertedError: ERC20InsufficientBalance

  Chain:    1 (Ethereum mainnet)
  Wallet:   MetaMask via window.ethereum
  Contract: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (USDC)
  Function: transfer(address, uint256)
  Args:     [0xRecipient…, 100000000]   // 100 USDC

  Revert decoded:
    errorName:  ERC20InsufficientBalance
    sender:     0xUser…
    balance:    50000000     // 50 USDC
    needed:     100000000    // 100 USDC

  Breadcrumbs leading up:
    [12:30:01] web3.wallet  connected MetaMask, chainId=1
    [12:30:05] ui.click     button "Send 100 USDC"
    [12:30:06] web3.error   Reverted: ERC20InsufficientBalance
```

## Install

```bash
pnpm add @arguslog/sdk-browser @arguslog/sdk-web3
# plus whichever client(s) you use:
pnpm add viem                # EVM, modern
pnpm add ethers              # EVM, legacy
pnpm add @solana/web3.js     # Solana
pnpm add @coral-xyz/anchor   # Solana, Anchor framework (optional)
```

All four are **optional peer dependencies** — install only what you actually use. The
decoder operates on duck-typed objects, so it never imports any of them at runtime; you
can mix EVM and Solana in the same app and both error sources will round-trip through
`captureWeb3Error`. The auto-wrap helper currently targets viem's `WalletClient` API
(EVM); Solana support today is via `captureWeb3Error()` in your own `try/catch`.

## Quick start

```ts
import { init } from '@arguslog/sdk-browser';
import { initWeb3 } from '@arguslog/sdk-web3';
import { createWalletClient, custom } from 'viem';
import { mainnet } from 'viem/chains';

// 1. Standard browser SDK init.
init({
  dsn: 'arguslog://<publicKey>@<host>/api/<projectId>',
  integrations: ['globalHandlers', 'autoBreadcrumbs'],
});

// 2. Wrap your wallet client + listen to provider events.
const rawClient = createWalletClient({
  chain: mainnet,
  transport: custom(window.ethereum),
});

const { walletClient } = initWeb3({
  provider: window.ethereum,
  walletClient: rawClient,
});

// 3. Use walletClient as usual — every error is auto-captured with full context.
await walletClient!.writeContract({
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  abi: usdcAbi,
  functionName: 'transfer',
  args: ['0xRecipient', 100_000000n],
});
```

### Wire EVERYTHING in one call

`initWeb3` accepts every Phase 1–4 input and returns each one wrapped. Pass whatever you
have — anything you omit is skipped, so the same call works for an EVM-only app, a
Solana-only app, or a hybrid:

```ts
const {
  walletClient, // viem WalletClient — write methods auto-captured
  publicClient, // viem PublicClient — read failures auto-captured
  ethersContracts, // [Contract, ...] — every method auto-captured
  solanaConnection, // @solana/web3.js Connection — sendTx/sim/confirm auto-captured
  anchorPrograms, // [Program, ...] — every methods.X.rpc/.simulate auto-captured
  uninstall,
} = initWeb3({
  provider: window.ethereum,
  walletClient: rawWalletClient,
  publicClient: rawPublicClient,
  ethersContracts: [erc20Contract, ammContract],
  solanaConnection: rawSolanaConnection,
  solanaWallet: phantomAdapter,
  anchorPrograms: [swapProgram],
  queryClient, // wagmi mutation reporter
  wrapOptions: { chain: { id: 1, name: 'Ethereum' } },
});
```

`uninstall()` tears down every listener installed in this call — call it on hot-reload or
on user logout.

## Manual capture (ethers, Solana, raw provider, …)

When you can't / don't want to wrap a client, capture errors yourself in a `try/catch`:

```ts
import { captureWeb3Error } from '@arguslog/sdk-web3';

// EVM example with ethers v6
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

// Solana example with @solana/web3.js + Anchor
try {
  await program.methods.swapTokens(amountIn, minOut).rpc();
} catch (err) {
  captureWeb3Error(err, {
    chain: { id: 'mainnet-beta', name: 'Solana mainnet' },
    wallet: 'phantom',
    contract: program.programId.toBase58(),
    functionName: 'swapTokens',
    args: [amountIn, minOut],
  });
  throw err;
}
```

The decoder runs in this order: **viem** (richest typed errors) → **ethers v6** (`.code`
field) → **Solana** (Anchor / wallet adapter / log parser) → generic `Error.message`.
Whatever it extracts goes onto the captured event as **tags** (searchable: `web3.kind`,
`web3.chain`, `web3.wallet`, `web3.contract`) and as a rich **breadcrumb** (the full
structured data).

## What `initWeb3` actually wires

| Wired thing                           | Effect                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EIP-1193 `accountsChanged`            | Breadcrumb with the (truncated) new address. Empty array → "wallet disconnected" at warning level.                                                                                                                                                |
| EIP-1193 `chainChanged`               | Breadcrumb with hex + decoded decimal chain id. Sentry-style "you switched mid-flow" detection.                                                                                                                                                   |
| EIP-1193 `connect`/`disconnect`       | Breadcrumbs for session boundaries.                                                                                                                                                                                                               |
| WalletConnect v2 session events       | `display_uri`, `session_update`, `session_event`, `session_delete` (warning), `session_expire` (warning), `session_request*`, `session_authenticate`.                                                                                             |
| viem `WalletClient` writes            | `writeContract` / `sendTransaction` / `deployContract` / `signMessage` / `signTypedData` / `signTransaction` / `prepareTransactionRequest` — try/catch each, on throw → `captureWeb3Error`; on success → `web3.tx` / `web3.sign` breadcrumb.      |
| viem `PublicClient` reads             | `readContract` / `simulateContract` / `estimateGas` / `estimateContractGas` / `call` / `waitForTransactionReceipt` / `getTransactionReceipt` / `getTransaction` — failures captured (successes silent — read calls fire too often to breadcrumb). |
| ethers v6 `Contract` methods          | Every callable on the contract is wrapped; ERC20 reads (`balanceOf`, `totalSupply`, `allowance`, `decimals`, `symbol`, `name`) skipped by default.                                                                                                |
| `@coral-xyz/anchor` `Program.methods` | Builder-chain interception: `methods.X.rpc()` / `.simulate()` / `.transaction()` are instrumented with the program ID as the contract field.                                                                                                      |
| `@solana/web3.js Connection`          | `sendTransaction` / `sendRawTransaction` / `simulateTransaction` / `confirmTransaction` — errors captured + success breadcrumbs.                                                                                                                  |
| `@solana/wallet-adapter-base`         | `connect`, `disconnect`, `error`, `readyStateChange` adapter events.                                                                                                                                                                              |
| wagmi v2 mutation cache               | Subscribes to `useWriteContract` / `useSendTransaction` / `useSignMessage` / `useSwitchChain` / `useConnect` / `useDisconnect` mutations; routes errors and successes through Arguslog without per-component try/catch.                           |

Read methods on the wallet client (`getBalance`, `getBlock`, etc.) pass through unchanged
— RPC calls are already breadcrumbed by the `fetch` integration in
`@arguslog/sdk-browser`.

## Decoded error kinds

`captureWeb3Error` emits a stable `web3.kind` tag the dashboard can group on:

| Kind                           | Source mapping                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user.rejected`                | viem `UserRejectedRequestError`, ethers `ACTION_REJECTED`, viem `TransactionRejectedRpcError`                                                                                                                                                                |
| `wallet.notConnected`          | (reserved — emitted by Phase 3 wagmi adapter)                                                                                                                                                                                                                |
| `chain.mismatch`               | viem `ChainMismatchError`                                                                                                                                                                                                                                    |
| `contract.reverted`            | viem `ContractFunctionRevertedError` (with `errorName` + `args`), ethers `CALL_EXCEPTION`                                                                                                                                                                    |
| `tx.executionFailed`           | viem `TransactionExecutionError`                                                                                                                                                                                                                             |
| `tx.replacementUnderpriced`    | ethers `REPLACEMENT_UNDERPRICED`                                                                                                                                                                                                                             |
| `tx.nonceExpired`              | viem `NonceTooLowError` / `NonceTooHighError`, ethers `NONCE_EXPIRED`                                                                                                                                                                                        |
| `tx.insufficientFunds`         | viem `InsufficientFundsError`, ethers `INSUFFICIENT_FUNDS`                                                                                                                                                                                                   |
| `gas.estimateFailed`           | viem `EstimateGasExecutionError`, ethers `UNPREDICTABLE_GAS_LIMIT`                                                                                                                                                                                           |
| `rpc.rateLimit`                | viem `RpcRequestError` / `HttpRequestError` with status 429                                                                                                                                                                                                  |
| `rpc.timeout`                  | viem `RpcRequestError` / `HttpRequestError`, ethers `NETWORK_ERROR` / `TIMEOUT` / `SERVER_ERROR`                                                                                                                                                             |
| `rpc.invalidParams`            | viem `InvalidParamsRpcError`                                                                                                                                                                                                                                 |
| `solana.programError`          | Solana custom program errors decoded from logs (`Program X failed: custom program error: 0xN`), `InstructionError` JSON-RPC variants, generic non-Anchor program failures.                                                                                   |
| `solana.anchorError`           | `@coral-xyz/anchor` `AnchorError` — both the typed object (`_isAnchorError: true`) AND the parsed log line (`Program log: AnchorError caused by account: X. Error Code: …`). Carries `errorCode`, `errorNumber`, `origin`, `errorMessage`, `comparedValues`. |
| `solana.simulationFailed`      | `Connection.simulateTransaction` preflight rejected the tx.                                                                                                                                                                                                  |
| `solana.blockhashExpired`      | `TransactionExpiredBlockheightExceededError` — tx not landed in time, retryable.                                                                                                                                                                             |
| `solana.computeBudgetExceeded` | Compute units exceeded the per-tx budget.                                                                                                                                                                                                                    |
| `solana.insufficientLamports`  | `InsufficientFundsForRent` or "insufficient lamports" message — account doesn't have enough SOL for rent or transfer.                                                                                                                                        |
| `unknown`                      | Anything we couldn't map — original error name / code preserved on the payload.                                                                                                                                                                              |

## Phase 3 — wagmi, Solana auto-wrap, WalletConnect

### wagmi v2 reporter

Subscribe once at app boot and every wagmi mutation error — `useWriteContract`,
`useSendTransaction`, `useSignMessage`, `useSwitchChain`, etc. — flows into Arguslog with
the right context extracted from the mutation variables. No per-component try/catch.

```ts
import { QueryClient } from '@tanstack/react-query';
import { installWagmiReporter } from '@arguslog/sdk-web3';

const queryClient = new QueryClient();
installWagmiReporter(queryClient, { wallet: 'metamask', chain: { id: 1, name: 'Ethereum' } });
```

Tracked mutation keys: `writeContract`, `sendTransaction`, `signMessage`, `signTypedData`,
`switchChain`, `connect`, `disconnect`. Untracked queries / user mutations pass through
silently.

### `wrapSolanaConnection`

Counterpart to `wrapWalletClient`, for `@solana/web3.js`:

```ts
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { wrapSolanaConnection } from '@arguslog/sdk-web3';

const connection = wrapSolanaConnection(new Connection(clusterApiUrl('mainnet-beta')), {
  wallet: 'phantom',
  chain: { id: 'mainnet-beta', name: 'Solana mainnet' },
});

// sendTransaction / sendRawTransaction / simulateTransaction / confirmTransaction errors
// are auto-captured with chain + wallet + decoded program logs.
```

### `wrapEthersContract`

For ethers v6 contract instances — auto-instruments every callable on the contract so
both writes and reads that fail land in Arguslog with the contract address and method name
attached:

```ts
import { Contract } from 'ethers';
import { wrapEthersContract } from '@arguslog/sdk-web3';

const erc20 = wrapEthersContract(new Contract(addr, abi, signer), {
  wallet: 'metamask',
  chain: { id: 1, name: 'Ethereum' },
});

await erc20.transfer(recipient, amount); // auto-captures revert / user rejection / RPC error
```

Standard ERC20 reads (`balanceOf`, `totalSupply`, `allowance`, `decimals`, `symbol`,
`name`) are skipped by default to avoid breadcrumb noise — pass `skip: new Set()` to wrap
them too.

### `wrapAnchorProgram`

For `@coral-xyz/anchor` programs — wraps `program.methods` so every instruction call's
terminal `.rpc()` / `.simulate()` / `.transaction()` is auto-instrumented with the program
ID as the contract field:

```ts
import { Program } from '@coral-xyz/anchor';
import { wrapAnchorProgram } from '@arguslog/sdk-web3';

const program = wrapAnchorProgram(new Program(idl, programId, provider), {
  wallet: 'phantom',
  chain: { id: 'mainnet-beta', name: 'Solana mainnet' },
});

await program.methods.swap(amountIn, minOut).accounts({...}).rpc();
// AnchorError logs are decoded via the Solana decoder; success leaves a `web3.tx` breadcrumb.
```

### `wrapPublicClient`

For viem `PublicClient` — captures READ-side failures (revert reasons surfaced by
`simulateContract`, gas-estimation reverts, RPC timeouts on `waitForTransactionReceipt`).
Successful reads are not breadcrumbed (read calls happen constantly):

```ts
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { wrapPublicClient } from '@arguslog/sdk-web3';

const publicClient = wrapPublicClient(createPublicClient({ chain: mainnet, transport: http() }), {
  chain: { id: 1, name: 'Ethereum' },
});
```

### `installSolanaWalletBreadcrumbs`

Listen to `@solana/wallet-adapter-base` adapter events:

```ts
import { useWallet } from '@solana/wallet-adapter-react';
import { installSolanaWalletBreadcrumbs } from '@arguslog/sdk-web3';

const { wallet } = useWallet();
useEffect(() => {
  if (!wallet?.adapter) return;
  return installSolanaWalletBreadcrumbs(wallet.adapter);
}, [wallet]);
```

`connect`, `disconnect`, `error`, `readyStateChange` events become `web3.wallet`
breadcrumbs.

### `installWalletConnectBreadcrumbs`

WalletConnect v2 providers fire session-lifecycle events that EIP-1193 doesn't define.
Layer this on top of `installProviderBreadcrumbs` for the WC-specific signals
(`display_uri`, `session_event`, `session_update`, `session_delete`, `session_expire`).

```ts
import { installProviderBreadcrumbs, installWalletConnectBreadcrumbs } from '@arguslog/sdk-web3';

installProviderBreadcrumbs(wcProvider); // standard EIP-1193 events
installWalletConnectBreadcrumbs(wcProvider); // + WC session lifecycle
```

`initWeb3` auto-detects WC providers and installs both, so the typical app only ever calls
`initWeb3` once.

## Roadmap

- **Phase 1** ✅ — viem + ethers v6 decoders, EIP-1193 provider events, `wrapWalletClient`.
- **Phase 2** ✅ — Solana support via `@solana/web3.js` + Anchor; wallet adapter errors;
  program-log parsing (Anchor + custom-error hex codes).
- **Phase 3** ✅ — wagmi v2 mutation cache reporter, `wrapSolanaConnection`,
  `installSolanaWalletBreadcrumbs`, WalletConnect lifecycle breadcrumbs.
- **Phase 4** ✅ — full auto-breadcrumb coverage: success-path breadcrumbs across every
  wrapper, plus `wrapEthersContract`, `wrapAnchorProgram`, `wrapPublicClient` so reads,
  writes, simulations, confirmations, signs and chain switches all flow into the
  breadcrumb timeline as a coherent narrative leading up to any failure.
- **Phase 5** — server-side ABI / Anchor IDL upload → richer decoding of custom errors the
  client-side bundle didn't include; first-class wagmi `connector` event listening.

## License

MIT — see [LICENSE](https://github.com/petarnenov/arguslog/blob/main/LICENSE).
