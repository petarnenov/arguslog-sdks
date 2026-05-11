/**
 * Wallet identifier the SDK can recognise. EVM wallets are detected from the EIP-1193
 * provider's {@code isMetaMask} / {@code isCoinbaseWallet} / etc. flags; Solana wallets via
 * {@code window.phantom?.solana?.isPhantom} or {@code window.solflare}, etc. Consumer code is
 * free to pass any other string explicitly via {@code captureWeb3Error(_, { wallet: 'rabby' })}.
 */
export type WalletKind =
  // EVM
  | 'metamask'
  | 'coinbase'
  | 'walletconnect'
  | 'rainbow'
  | 'phantom-evm'
  | 'rabby'
  | 'trust'
  | 'safe'
  // Solana
  | 'phantom'
  | 'solflare'
  | 'backpack'
  | 'glow'
  | 'unknown'
  | (string & {});

/** Chain we observed the error on. EVM uses numeric ids (1, 8453, 137, …); Solana uses cluster names ('mainnet-beta', 'devnet', 'testnet'), which we still pack into the {@code id} field as a stable string. */
export interface ChainInfo {
  id: number | string;
  name?: string;
}

/** Context callers attach to a manually-captured error. Any field can be omitted. */
export interface Web3ErrorContext {
  chain?: ChainInfo;
  wallet?: WalletKind;
  /** Address of the contract / program being interacted with. */
  contract?: `0x${string}` | string;
  /** Function / instruction name being called (e.g. {@code 'transfer'}). */
  functionName?: string;
  /** Args passed to the contract function — stringified at capture time. */
  args?: readonly unknown[];
  /** Account / signer address for the call. */
  account?: `0x${string}` | string;
  /** Transaction hash / signature if the tx was actually dispatched before failing. */
  transactionHash?: `0x${string}` | string;
  /** Estimated gas / compute units (if available). */
  gasEstimate?: bigint | number | string;
  /** Free-form extra fields. */
  extra?: Record<string, unknown>;
}

/**
 * Normalised representation of the error after decoding. Consumer code rarely sees this
 * directly — it's the bridge between the raw library error and the breadcrumb / event payload
 * the SDK ships.
 */
export interface DecodedWeb3Error {
  /** Stable kind identifier the dashboard can group / filter on. */
  kind: Web3ErrorKind;
  /** Short human-readable summary suitable for the breadcrumb message. */
  shortMessage: string;
  /** The full revert / RPC error data. JSON-safe — bigints are stringified. */
  data: Record<string, unknown>;
  /** Source library that produced the error. */
  source: 'viem' | 'ethers' | 'eip-1193' | 'solana' | 'anchor' | 'solana-wallet' | 'unknown';
}

export type Web3ErrorKind =
  // Cross-ecosystem
  | 'user.rejected'
  | 'wallet.notConnected'
  | 'rpc.rateLimit'
  | 'rpc.timeout'
  | 'rpc.invalidParams'
  | 'unknown'
  // EVM-specific
  | 'chain.mismatch'
  | 'contract.reverted'
  | 'tx.executionFailed'
  | 'tx.replacementUnderpriced'
  | 'tx.nonceExpired'
  | 'tx.insufficientFunds'
  | 'gas.estimateFailed'
  // Solana-specific
  | 'solana.programError'
  | 'solana.anchorError'
  | 'solana.simulationFailed'
  | 'solana.blockhashExpired'
  | 'solana.computeBudgetExceeded'
  | 'solana.insufficientLamports';
