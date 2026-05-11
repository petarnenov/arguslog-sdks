import { captureWeb3Error } from './capture-web3-error.js';
import { recordTxBreadcrumb } from './record-tx-breadcrumb.js';
import type { ChainInfo, WalletKind, Web3ErrorContext } from './types.js';

/**
 * Wraps a {@code @solana/web3.js} {@code Connection} so the methods that actually fail
 * with rich errors are auto-instrumented. Read-only RPC fan-out ({@code getBalance},
 * {@code getAccountInfo}, etc.) passes through unwrapped — those are already breadcrumbed
 * by the {@code fetch} integration in {@code @arguslog/sdk-browser}.
 *
 * <p>Tracked methods:
 *
 * <ul>
 *   <li>{@code sendTransaction} — main dispatch path. The error here is typically a
 *       {@code SendTransactionError} carrying logs + signature, decoded by the Solana
 *       decoder. Successful dispatch leaves a {@code web3.tx} breadcrumb with the
 *       returned signature.</li>
 *   <li>{@code sendRawTransaction} — pre-signed transaction submit.</li>
 *   <li>{@code simulateTransaction} — preflight; surfaces {@code solana.simulationFailed}
 *       or unwraps an Anchor error from the simulation logs. Successful simulation leaves
 *       a {@code web3.simulate} breadcrumb.</li>
 *   <li>{@code confirmTransaction} — confirmation wait; throws on
 *       {@code TransactionExpiredBlockheightExceededError} which decodes to
 *       {@code solana.blockhashExpired}. Successful confirmation leaves a
 *       {@code web3.confirm} breadcrumb.</li>
 * </ul>
 */
const TRACKED_METHODS = new Set([
  'sendTransaction',
  'sendRawTransaction',
  'simulateTransaction',
  'confirmTransaction',
]);

export interface WrapSolanaConnectionOptions {
  /** Default wallet stamp for every captured error. */
  wallet?: WalletKind;
  /** Default chain info. Solana clusters use string ids ('mainnet-beta', 'devnet'). */
  chain?: ChainInfo;
  /** Per-call context override — receives the method name + raw args. */
  enrichContext?: (method: string, args: readonly unknown[]) => Partial<Web3ErrorContext>;
  /** When true (default), also record success breadcrumbs alongside error captures. */
  recordSuccess?: boolean;
}

export function wrapSolanaConnection<T extends object>(
  connection: T,
  options: WrapSolanaConnectionOptions = {},
): T {
  return new Proxy(connection, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      if (!TRACKED_METHODS.has(prop)) return value;

      return async (...args: unknown[]) => {
        const ctx: Web3ErrorContext = {
          wallet: options.wallet,
          chain: options.chain,
          functionName: prop,
          ...(options.enrichContext?.(prop, args) ?? {}),
        };
        try {
          const result = await Reflect.apply(value, target, args);
          if (options.recordSuccess !== false) {
            recordTxBreadcrumb({
              kind: kindFor(prop),
              message: successMessage(prop, result),
              context: ctx,
              result: typeof result === 'string' ? result : undefined,
            });
          }
          return result;
        } catch (error) {
          captureWeb3Error(error, ctx);
          throw error;
        }
      };
    },
  });
}

function kindFor(method: string): 'tx' | 'simulate' | 'confirm' {
  if (method === 'simulateTransaction') return 'simulate';
  if (method === 'confirmTransaction') return 'confirm';
  return 'tx';
}

function successMessage(method: string, result: unknown): string {
  if (method === 'sendTransaction' || method === 'sendRawTransaction') {
    if (typeof result === 'string') return `${method} → ${truncateSig(result)}`;
    return method;
  }
  if (method === 'simulateTransaction') return 'simulation OK';
  if (method === 'confirmTransaction') return 'confirmed';
  return method;
}

function truncateSig(sig: string): string {
  return sig.length > 14 ? `${sig.slice(0, 10)}…${sig.slice(-4)}` : sig;
}
