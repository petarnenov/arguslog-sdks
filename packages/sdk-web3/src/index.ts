/**
 * @arguslog/sdk-web3 — rich Web3 error capture for viem, ethers v6, @solana/web3.js + Anchor,
 * wagmi, and WalletConnect. Plug this on top of {@code @arguslog/sdk-browser}.
 *
 * <p>When a wallet write reverts you no longer see "Error: Transaction failed" — you see the
 * chain, the wallet, the contract / program, the function / instruction, the args, and the
 * decoded revert reason / Anchor error / custom program error.
 */
export { captureWeb3Error } from './capture-web3-error.js';
export { decodeViemError } from './decode-viem-error.js';
export { decodeEthersError } from './decode-ethers-error.js';
export { decodeSolanaError } from './decode-solana-error.js';
export { installProviderBreadcrumbs, detectWallet, type Eip1193Provider } from './eip-1193.js';
export { installWalletConnectBreadcrumbs } from './walletconnect.js';
export {
  installSolanaWalletBreadcrumbs,
  type SolanaWalletAdapter,
} from './solana-wallet-adapter.js';
export { wrapWalletClient, type WrapWalletClientOptions } from './wrap-wallet-client.js';
export {
  wrapSolanaConnection,
  type WrapSolanaConnectionOptions,
} from './wrap-solana-connection.js';
export { wrapEthersContract, type WrapEthersContractOptions } from './wrap-ethers-contract.js';
export { wrapAnchorProgram, type WrapAnchorProgramOptions } from './wrap-anchor-program.js';
export { wrapPublicClient, type WrapPublicClientOptions } from './wrap-public-client.js';
export { recordTxBreadcrumb } from './record-tx-breadcrumb.js';
export {
  installWagmiReporter,
  type MutationCacheLike,
  type MutationCacheNotifyEvent,
  type QueryClientLike,
  type WagmiReporterOptions,
} from './wagmi-reporter.js';
export type {
  ChainInfo,
  DecodedWeb3Error,
  WalletKind,
  Web3ErrorContext,
  Web3ErrorKind,
} from './types.js';

import { installProviderBreadcrumbs, detectWallet, type Eip1193Provider } from './eip-1193.js';
import {
  installSolanaWalletBreadcrumbs,
  type SolanaWalletAdapter,
} from './solana-wallet-adapter.js';
import { installWalletConnectBreadcrumbs } from './walletconnect.js';
import {
  installWagmiReporter,
  type QueryClientLike,
  type WagmiReporterOptions,
} from './wagmi-reporter.js';
import { wrapAnchorProgram, type WrapAnchorProgramOptions } from './wrap-anchor-program.js';
import { wrapEthersContract, type WrapEthersContractOptions } from './wrap-ethers-contract.js';
import { wrapPublicClient, type WrapPublicClientOptions } from './wrap-public-client.js';
import {
  wrapSolanaConnection,
  type WrapSolanaConnectionOptions,
} from './wrap-solana-connection.js';
import { wrapWalletClient, type WrapWalletClientOptions } from './wrap-wallet-client.js';

/**
 * Convenience init that wires EVERY auto-breadcrumb / auto-capture piece in one call. Pass
 * any combination of the inputs you have in your app — anything you omit is skipped, so
 * the same call works for an EVM-only app, a Solana-only app, or a hybrid.
 *
 * <ul>
 *   <li>{@code provider} — an EIP-1193 provider ({@code window.ethereum} or a WalletConnect
 *       provider). Standard EIP-1193 events become breadcrumbs; if {@code walletConnect: true}
 *       (or auto-detected) WC-specific session events are recorded too.</li>
 *   <li>{@code walletClient} — a viem {@code WalletClient}. Returned wrapped — every write
 *       method auto-captures its errors and emits a {@code web3.tx} success breadcrumb.</li>
 *   <li>{@code publicClient} — a viem {@code PublicClient}. Returned wrapped — read-side
 *       failures (revert reasons, gas-estimation errors, RPC timeouts) flow into Arguslog.</li>
 *   <li>{@code ethersContracts} — array of ethers v6 {@code Contract}s. Returned wrapped in
 *       the same order; each method call is auto-instrumented (ERC20 reads skipped by default).</li>
 *   <li>{@code solanaConnection} — a {@code @solana/web3.js} {@code Connection}. Returned
 *       wrapped — sendTransaction / simulateTransaction / confirmTransaction auto-capture.</li>
 *   <li>{@code solanaWallet} — a {@code @solana/wallet-adapter-base} adapter. Connect /
 *       disconnect / error / readyStateChange events become breadcrumbs.</li>
 *   <li>{@code anchorPrograms} — array of {@code @coral-xyz/anchor} programs. Returned
 *       wrapped — every {@code methods.X.rpc()/.simulate()/.transaction()} call captures.</li>
 *   <li>{@code queryClient} — a TanStack Query client (the one wagmi uses). Subscribes the
 *       wagmi reporter so {@code useWriteContract} / {@code useSendTransaction} / etc errors
 *       and successes flow into Arguslog without per-component try/catch.</li>
 * </ul>
 *
 * <p>Returns wrapped clients (where supplied) and a single {@code uninstall} that tears down
 * every listener installed during this call. Safe to call again on hot-reload.
 */
export function initWeb3<
  W extends object = object,
  P extends object = object,
  C extends object = object,
  E extends object = object,
  A extends object = object,
>(opts: {
  provider?: Eip1193Provider | null;
  walletClient?: W;
  publicClient?: P;
  ethersContracts?: readonly E[];
  solanaConnection?: C;
  solanaWallet?: SolanaWalletAdapter | null;
  anchorPrograms?: readonly A[];
  queryClient?: QueryClientLike;
  wrapOptions?: WrapWalletClientOptions;
  publicClientOptions?: WrapPublicClientOptions;
  ethersContractOptions?: WrapEthersContractOptions;
  solanaWrapOptions?: WrapSolanaConnectionOptions;
  anchorProgramOptions?: WrapAnchorProgramOptions;
  wagmiOptions?: WagmiReporterOptions;
  /** Force WC-specific event listeners (display_uri / session_*). Auto-detected from the provider when omitted. */
  walletConnect?: boolean;
}): {
  walletClient: W | undefined;
  publicClient: P | undefined;
  ethersContracts: E[] | undefined;
  solanaConnection: C | undefined;
  anchorPrograms: A[] | undefined;
  uninstall: () => void;
} {
  const uninstallers: Array<() => void> = [];

  if (opts.provider) {
    uninstallers.push(installProviderBreadcrumbs(opts.provider));
    if (opts.walletConnect ?? looksLikeWalletConnect(opts.provider)) {
      uninstallers.push(installWalletConnectBreadcrumbs(opts.provider));
    }
  }

  if (opts.solanaWallet) {
    uninstallers.push(installSolanaWalletBreadcrumbs(opts.solanaWallet));
  }

  if (opts.queryClient) {
    uninstallers.push(installWagmiReporter(opts.queryClient, opts.wagmiOptions ?? {}));
  }

  const wallet = opts.provider ? detectWallet(opts.provider) : undefined;
  const wrapOptions: WrapWalletClientOptions = {
    ...(opts.wrapOptions ?? {}),
    wallet: opts.wrapOptions?.wallet ?? wallet,
  };
  const walletClient = opts.walletClient
    ? wrapWalletClient(opts.walletClient, wrapOptions)
    : undefined;

  const publicClient = opts.publicClient
    ? wrapPublicClient(opts.publicClient, opts.publicClientOptions ?? {})
    : undefined;

  const ethersContracts = opts.ethersContracts
    ? opts.ethersContracts.map((c) =>
        wrapEthersContract(c, {
          wallet,
          ...(opts.ethersContractOptions ?? {}),
        }),
      )
    : undefined;

  const solanaConnection = opts.solanaConnection
    ? wrapSolanaConnection(opts.solanaConnection, opts.solanaWrapOptions ?? {})
    : undefined;

  const anchorPrograms = opts.anchorPrograms
    ? opts.anchorPrograms.map((p) =>
        wrapAnchorProgram(
          p as A & { programId?: { toBase58(): string } },
          opts.anchorProgramOptions ?? {},
        ),
      )
    : undefined;

  return {
    walletClient,
    publicClient,
    ethersContracts,
    solanaConnection,
    anchorPrograms,
    uninstall: () => {
      for (const off of uninstallers) off();
    },
  };
}

function looksLikeWalletConnect(provider: Eip1193Provider): boolean {
  // WalletConnect v2 providers expose a `session` object and a `signer` field. Light-touch
  // detection — better to under-detect (consumer can force walletConnect: true) than to spam
  // breadcrumbs on a regular MetaMask provider that doesn't speak the WC events.
  const p = provider as unknown as Record<string, unknown>;
  return 'session' in p && typeof p['session'] === 'object';
}
