import { captureWeb3Error } from './capture-web3-error.js';
import { recordTxBreadcrumb } from './record-tx-breadcrumb.js';
import type { WalletKind, Web3ErrorContext } from './types.js';

/**
 * Subscribes to wagmi v2's mutation cache (TanStack Query under the hood) and routes
 * errors from tracked wagmi mutations through {@link captureWeb3Error}. Lets a React app
 * use {@code useWriteContract}, {@code useSendTransaction}, {@code useSwitchChain}, etc.
 * without sprinkling try/catches in every component — the reporter is install-once at app
 * boot, errors flow into Arguslog automatically.
 *
 * <p>Tracked mutation keys (the {@code mutationKey[0]} string wagmi sets on each mutation):
 *
 * <ul>
 *   <li>{@code writeContract} — main write path; mutation variables carry the contract
 *       address, function name, and args we extract.</li>
 *   <li>{@code sendTransaction} — raw value transfers / EVM transactions.</li>
 *   <li>{@code signMessage} / {@code signTypedData}</li>
 *   <li>{@code switchChain} — useful for "user rejected the chain switch" detection.</li>
 *   <li>{@code connect} / {@code disconnect}</li>
 * </ul>
 *
 * <p>{@code @tanstack/react-query} is an optional peer dep — wagmi v2 already requires it,
 * so installing this reporter is just a one-liner in apps that use wagmi.
 */
const TRACKED_MUTATIONS = new Set([
  'writeContract',
  'sendTransaction',
  'signMessage',
  'signTypedData',
  'switchChain',
  'connect',
  'disconnect',
]);

/** Subset of TanStack Query's mutation cache that we depend on. Intentionally duck-typed. */
export interface MutationCacheLike {
  subscribe(listener: (event: MutationCacheNotifyEvent) => void): () => void;
}

export interface QueryClientLike {
  getMutationCache(): MutationCacheLike;
}

export interface MutationCacheNotifyEvent {
  type: string;
  mutation?: {
    state?: { status?: string; error?: unknown; variables?: unknown; data?: unknown };
    options?: { mutationKey?: readonly unknown[] };
  };
}

export interface WagmiReporterOptions {
  /** Default wallet kind to stamp on every captured error. Optional — wagmi mutations don't carry it. */
  wallet?: WalletKind;
  /** Default chain info — wagmi exposes the active chain via useChainId(); pass it through here. */
  chain?: { id: number | string; name?: string };
  /**
   * Extra context to merge into every captured event. Called with the wagmi mutation key and
   * the variables the user passed to the mutation; whatever you return is shallow-merged
   * into {@link Web3ErrorContext}.
   */
  enrichContext?: (action: string, variables: unknown) => Partial<Web3ErrorContext>;
  /**
   * When true (default), every successful tracked wagmi mutation also leaves an info-level
   * {@code web3.tx} / {@code web3.sign} / {@code web3.switch} breadcrumb. Set false if you
   * only want failures recorded.
   */
  recordSuccess?: boolean;
}

export function installWagmiReporter(
  queryClient: QueryClientLike,
  options: WagmiReporterOptions = {},
): () => void {
  const cache = queryClient.getMutationCache();
  return cache.subscribe((event) => {
    if (event.type !== 'updated') return;
    const status = event.mutation?.state?.status;
    if (status !== 'error' && status !== 'success') return;

    const mutationKey = event.mutation?.options?.mutationKey;
    if (!Array.isArray(mutationKey) || mutationKey.length === 0) return;
    const action = mutationKey[0];
    if (typeof action !== 'string' || !TRACKED_MUTATIONS.has(action)) return;

    const variables = event.mutation?.state?.variables;
    const baseCtx = extractContext(action, variables);
    const userCtx = options.enrichContext?.(action, variables) ?? {};
    const ctx: Web3ErrorContext = {
      wallet: options.wallet,
      chain: options.chain,
      ...baseCtx,
      ...userCtx,
    };

    if (status === 'error') {
      const error = event.mutation?.state?.error;
      if (!error) return;
      captureWeb3Error(error, ctx);
      return;
    }

    // status === 'success'
    if (options.recordSuccess === false) return;
    const result = event.mutation?.state?.data;
    recordTxBreadcrumb({
      kind: kindFor(action),
      message: successMessage(action, ctx, result),
      context: ctx,
      result: typeof result === 'string' ? result : undefined,
    });
  });
}

function kindFor(action: string): 'tx' | 'sign' | 'switch' {
  if (action === 'signMessage' || action === 'signTypedData') return 'sign';
  if (action === 'switchChain') return 'switch';
  return 'tx';
}

function successMessage(action: string, ctx: Web3ErrorContext, result: unknown): string {
  if (action === 'writeContract' || action === 'sendTransaction') {
    const head = ctx.functionName ?? action;
    const target = ctx.contract ? ` ${ctx.contract}` : '';
    const hash = typeof result === 'string' ? ` → ${truncateHash(result)}` : '';
    return `${head}${target}${hash}`;
  }
  if (action === 'switchChain') {
    return `switched chain → ${ctx.chain?.id ?? '?'}`;
  }
  return `${action} succeeded`;
}

function truncateHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 10)}…${hash.slice(-4)}` : hash;
}

function extractContext(action: string, variables: unknown): Partial<Web3ErrorContext> {
  if (!isObject(variables)) return { functionName: action };
  if (action === 'writeContract') {
    return {
      functionName: readString(variables, 'functionName') ?? 'writeContract',
      contract: readString(variables, 'address'),
      args: readArray(variables, 'args'),
    };
  }
  if (action === 'sendTransaction') {
    return {
      functionName: 'sendTransaction',
      contract: readString(variables, 'to'),
    };
  }
  if (action === 'switchChain') {
    const chainId = readNumber(variables, 'chainId');
    return {
      functionName: 'switchChain',
      chain: chainId !== undefined ? { id: chainId } : undefined,
    };
  }
  return { functionName: action };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' ? v : undefined;
}

function readArray(
  obj: Record<string, unknown>,
  key: string,
): readonly unknown[] | undefined {
  const v = obj[key];
  return Array.isArray(v) ? v : undefined;
}
