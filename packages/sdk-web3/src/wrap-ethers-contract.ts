import { captureWeb3Error } from './capture-web3-error.js';
import { recordTxBreadcrumb } from './record-tx-breadcrumb.js';
import type { ChainInfo, WalletKind, Web3ErrorContext } from './types.js';

/**
 * Auto-wraps an ethers v6 {@code Contract} (or any object whose enumerable function members
 * are contract methods) so every method call is auto-instrumented. Returns a
 * {@link Proxy} — same shape as the input, just with each method call sandwiched in a
 * try/catch that funnels errors through {@link captureWeb3Error}.
 *
 * <p>Why a separate wrapper from {@code wrapWalletClient}: ethers v6 contracts expose ABI
 * functions directly on the contract instance (you call {@code contract.transfer(addr, amt)}
 * not {@code wallet.writeContract({ functionName: 'transfer' })}). Different shape, different
 * argument extraction, different success result (the response from a writable method is a
 * {@code TransactionResponse} with a {@code .hash}, not a hash string directly).
 *
 * <p>By default we wrap every callable property; the contract address is read once via
 * {@code contract.target} (ethers v6) or {@code contract.address} (v5 fallback) so each
 * captured error gets the contract field set without per-method extraction.
 */
export interface WrapEthersContractOptions {
  /** Wallet kind — usually carried over from the signer the contract was constructed with. */
  wallet?: WalletKind;
  /** Chain info — ethers Network includes chainId; pass it through. */
  chain?: ChainInfo;
  /** Override / extend per-call. */
  enrichContext?: (
    method: string,
    args: readonly unknown[],
  ) => Partial<Web3ErrorContext>;
  /** When true (default), record success breadcrumbs alongside error captures. */
  recordSuccess?: boolean;
  /**
   * Method names to skip from wrapping — useful for excluding read-only views you don't
   * want noise about. Standard ERC20 reads ({@code balanceOf}, {@code totalSupply},
   * {@code allowance}, {@code decimals}, {@code symbol}, {@code name}) are skipped by
   * default; pass an empty Set to wrap them too.
   */
  skip?: Set<string>;
}

const DEFAULT_SKIP = new Set([
  'balanceOf',
  'totalSupply',
  'allowance',
  'decimals',
  'symbol',
  'name',
  'getAddress',
  'connect',
  'attach',
  'on',
  'once',
  'off',
  'removeAllListeners',
  'queryFilter',
  'getEvent',
  'getFunction',
  'addEventListener',
  'removeEventListener',
  'addListener',
  'removeListener',
  'listenerCount',
  'listeners',
]);

export function wrapEthersContract<T extends object>(
  contract: T,
  options: WrapEthersContractOptions = {},
): T {
  const skip = options.skip ?? DEFAULT_SKIP;
  const contractAddress = readContractAddress(contract);

  return new Proxy(contract, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      if (skip.has(prop)) return value;
      // Skip framework-prefixed and dunder methods — wrapping toString / Symbol.iterator etc
      // breaks devtools and serialisation in surprising ways.
      if (prop.startsWith('_') || prop.startsWith('Symbol(')) return value;

      return async (...args: unknown[]) => {
        const ctx: Web3ErrorContext = {
          wallet: options.wallet,
          chain: options.chain,
          contract: contractAddress,
          functionName: prop,
          args,
          ...(options.enrichContext?.(prop, args) ?? {}),
        };
        try {
          const result = await Reflect.apply(value, target, args);
          if (options.recordSuccess !== false) {
            const hash = readTxHash(result);
            recordTxBreadcrumb({
              kind: 'tx',
              message: hash
                ? `${prop}${contractAddress ? ` ${contractAddress}` : ''} → ${truncate(hash)}`
                : prop,
              context: ctx,
              result: hash,
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

function readContractAddress(contract: object): string | undefined {
  // ethers v6 → .target (string | Addressable). v5 → .address (string).
  const t = (contract as { target?: unknown }).target;
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object' && 'address' in t && typeof t.address === 'string') {
    return t.address;
  }
  const a = (contract as { address?: unknown }).address;
  if (typeof a === 'string') return a;
  return undefined;
}

function readTxHash(result: unknown): string | undefined {
  // ethers v6 write returns a TransactionResponse — { hash, ... }. v5 same shape.
  if (result && typeof result === 'object' && 'hash' in result && typeof result.hash === 'string') {
    return result.hash;
  }
  // Some helper methods just return the hash string.
  if (typeof result === 'string' && /^0x[0-9a-f]{64}$/i.test(result)) return result;
  return undefined;
}

function truncate(s: string): string {
  return s.length > 14 ? `${s.slice(0, 10)}…${s.slice(-4)}` : s;
}
