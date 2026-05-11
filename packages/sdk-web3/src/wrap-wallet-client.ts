import { captureWeb3Error } from './capture-web3-error.js';
import { recordTxBreadcrumb } from './record-tx-breadcrumb.js';
import type { WalletKind, Web3ErrorContext } from './types.js';

/**
 * Wraps a viem {@code WalletClient} so every action that can throw is auto-instrumented.
 * The wrapper is a {@link Proxy} — same shape, same return values, just every call to a
 * tracked method is sandwiched in a try/catch that hands the error to {@link captureWeb3Error}
 * before re-throwing. The user code's own try/catch / await semantics are unchanged.
 *
 * <p>Tracked methods come from viem's wallet action surface: {@code writeContract},
 * {@code sendTransaction}, {@code signMessage}, {@code signTypedData}, {@code signTransaction},
 * {@code deployContract}, {@code prepareTransactionRequest}. These are the ones that fail
 * with rich typed errors (revert, user rejection, chain mismatch) and benefit most from
 * structured capture.
 *
 * <p>Read methods ({@code getBalance}, {@code getBlock}, etc.) are passed through unchanged
 * because they almost never throw the kind of error a customer would care about — they're
 * RPC calls and any failure is already breadcrumbed by the {@code fetch} integration in
 * {@code @arguslog/sdk-browser}.
 */
const TRACKED_METHODS = new Set([
  'writeContract',
  'sendTransaction',
  'signMessage',
  'signTypedData',
  'signTransaction',
  'deployContract',
  'prepareTransactionRequest',
]);

export interface WrapWalletClientOptions {
  /** Wallet kind to stamp on every captured error. Defaults to 'unknown'. */
  wallet?: WalletKind;
  /** Default chain id / name to stamp on every captured error. */
  chain?: { id: number; name?: string };
  /**
   * Hook to enrich the captured error context with per-call data. Called with the method
   * name and the args the user passed to it; whatever you return is shallow-merged into
   * {@link Web3ErrorContext}.
   */
  enrichContext?: (method: string, args: readonly unknown[]) => Partial<Web3ErrorContext>;
  /**
   * When true (default), every successful tracked call also leaves an info-level
   * {@code web3.tx} / {@code web3.sign} breadcrumb. Set false if you only want failures
   * recorded.
   */
  recordSuccess?: boolean;
}

export function wrapWalletClient<T extends object>(
  client: T,
  options: WrapWalletClientOptions = {},
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      if (!TRACKED_METHODS.has(prop)) return value;

      return async (...args: unknown[]) => {
        const context: Web3ErrorContext = {
          wallet: options.wallet,
          chain: options.chain,
          functionName: extractFunctionName(prop, args),
          contract: extractContract(prop, args),
          args: extractArgs(prop, args),
          ...(options.enrichContext?.(prop, args) ?? {}),
        };
        try {
          const result = await Reflect.apply(value, target, args);
          // Success path — record a breadcrumb at info level so the timeline reads as a
          // narrative leading up to whatever failure eventually fires.
          if (options.recordSuccess !== false) {
            recordTxBreadcrumb({
              kind: prop.startsWith('sign') ? 'sign' : 'tx',
              message: successMessage(prop, context, result),
              context,
              result: typeof result === 'string' ? result : undefined,
            });
          }
          return result;
        } catch (error) {
          captureWeb3Error(error, context);
          throw error;
        }
      };
    },
  });
}

function extractFunctionName(method: string, args: unknown[]): string | undefined {
  if (method === 'writeContract' || method === 'deployContract') {
    const opts = args[0] as { functionName?: string } | undefined;
    return opts?.functionName ?? (method === 'deployContract' ? 'constructor' : undefined);
  }
  if (method.startsWith('sign')) return method;
  return undefined;
}

function extractContract(method: string, args: unknown[]): string | undefined {
  if (method === 'writeContract') {
    const opts = args[0] as { address?: string } | undefined;
    return opts?.address;
  }
  if (method === 'sendTransaction') {
    const opts = args[0] as { to?: string } | undefined;
    return opts?.to;
  }
  return undefined;
}

function extractArgs(method: string, args: unknown[]): readonly unknown[] | undefined {
  if (method === 'writeContract' || method === 'deployContract') {
    const opts = args[0] as { args?: readonly unknown[] } | undefined;
    return opts?.args;
  }
  return undefined;
}

function successMessage(method: string, context: Web3ErrorContext, result: unknown): string {
  if (method === 'writeContract' || method === 'sendTransaction' || method === 'deployContract') {
    const head = context.functionName ?? method;
    const target = context.contract ? ` ${context.contract}` : '';
    const hash = typeof result === 'string' ? ` → ${truncateHash(result)}` : '';
    return `${head}${target}${hash}`;
  }
  if (method.startsWith('sign')) {
    return `${method} signed`;
  }
  return method;
}

function truncateHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 10)}…${hash.slice(-4)}` : hash;
}
