import { captureWeb3Error } from './capture-web3-error.js';
import type { ChainInfo, Web3ErrorContext } from './types.js';

/**
 * Wraps a viem {@code PublicClient} so READ-side failures (RPC errors, contract
 * simulation reverts, gas estimation reverts) get captured as Arguslog events. Successful
 * reads are NOT breadcrumbed by default — read calls happen constantly and would burn
 * the breadcrumb buffer instantly.
 *
 * <p>Tracked methods, all of which can throw a viem typed error worth capturing:
 *
 * <ul>
 *   <li>{@code readContract} — view function call; reverts if the function reverts.</li>
 *   <li>{@code simulateContract} — full execution simulation; surfaces revert reasons
 *       BEFORE the user spends gas. Catching simulation errors is often the best
 *       differentiator between "user error" and "bug in our code".</li>
 *   <li>{@code estimateGas} / {@code estimateContractGas} — pre-flight; reverting
 *       contracts surface the revert reason here.</li>
 *   <li>{@code call} — low-level eth_call.</li>
 *   <li>{@code waitForTransactionReceipt} — confirmation wait; throws on timeout.</li>
 *   <li>{@code getTransactionReceipt}, {@code getTransaction} — useful when polling for
 *       a tx that should exist but doesn't yet.</li>
 * </ul>
 */
const TRACKED_METHODS = new Set([
  'readContract',
  'simulateContract',
  'estimateGas',
  'estimateContractGas',
  'call',
  'waitForTransactionReceipt',
  'getTransactionReceipt',
  'getTransaction',
]);

export interface WrapPublicClientOptions {
  chain?: ChainInfo;
  enrichContext?: (
    method: string,
    args: readonly unknown[],
  ) => Partial<Web3ErrorContext>;
}

export function wrapPublicClient<T extends object>(
  client: T,
  options: WrapPublicClientOptions = {},
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      if (!TRACKED_METHODS.has(prop)) return value;

      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(value, target, args);
        } catch (error) {
          const ctx: Web3ErrorContext = {
            chain: options.chain,
            functionName: extractFunctionName(prop, args),
            contract: extractContract(prop, args),
            args: extractArgs(prop, args),
            ...(options.enrichContext?.(prop, args) ?? {}),
          };
          captureWeb3Error(error, ctx);
          throw error;
        }
      };
    },
  });
}

function extractFunctionName(method: string, args: unknown[]): string | undefined {
  if (
    method === 'readContract' ||
    method === 'simulateContract' ||
    method === 'estimateContractGas'
  ) {
    const opts = args[0] as { functionName?: string } | undefined;
    return opts?.functionName ?? method;
  }
  return method;
}

function extractContract(method: string, args: unknown[]): string | undefined {
  if (
    method === 'readContract' ||
    method === 'simulateContract' ||
    method === 'estimateContractGas'
  ) {
    const opts = args[0] as { address?: string } | undefined;
    return opts?.address;
  }
  return undefined;
}

function extractArgs(method: string, args: unknown[]): readonly unknown[] | undefined {
  if (
    method === 'readContract' ||
    method === 'simulateContract' ||
    method === 'estimateContractGas'
  ) {
    const opts = args[0] as { args?: readonly unknown[] } | undefined;
    return opts?.args;
  }
  return undefined;
}
