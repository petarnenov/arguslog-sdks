import { captureWeb3Error } from './capture-web3-error.js';
import { recordTxBreadcrumb } from './record-tx-breadcrumb.js';
import type { ChainInfo, WalletKind, Web3ErrorContext } from './types.js';

/**
 * Auto-wraps a {@code @coral-xyz/anchor} {@code Program} instance so every instruction
 * builder under {@code program.methods.X.rpc() / .simulate() / .signers().rpc()} is
 * instrumented. Returns a {@link Proxy} layered over {@code program.methods} that wraps each
 * method's terminal {@code .rpc()} / {@code .simulate()} / {@code .transaction()} call.
 *
 * <p>Anchor's method builder pattern is two-step:
 *
 * <pre>
 *   await program.methods.swapTokens(amountIn, minOut).accounts({...}).rpc();
 * </pre>
 *
 * <p>We wrap {@code program.methods} so accessing any method ({@code swapTokens}) returns a
 * recording function that, after the user finishes the builder chain and awaits the
 * terminal call, observes the result / error and emits a breadcrumb. Builder chain methods
 * pass through unchanged.
 */
export interface WrapAnchorProgramOptions {
  wallet?: WalletKind;
  /** Defaults to mainnet-beta cluster shape if omitted. */
  chain?: ChainInfo;
  /** When true (default), record success breadcrumbs. */
  recordSuccess?: boolean;
  enrichContext?: (
    instruction: string,
    args: readonly unknown[],
  ) => Partial<Web3ErrorContext>;
}

interface AnchorProgram {
  programId?: { toBase58(): string };
  methods?: Record<string, (...args: unknown[]) => unknown>;
}

export function wrapAnchorProgram<T extends AnchorProgram>(
  program: T,
  options: WrapAnchorProgramOptions = {},
): T {
  const programId = program.programId?.toBase58?.();
  const methods = program.methods;
  if (!methods) return program;

  const wrappedMethods = new Proxy(methods, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;

      return (...instructionArgs: unknown[]) => {
        const builder = Reflect.apply(value, target, instructionArgs);
        if (!builder || typeof builder !== 'object') return builder;
        const ctx: Web3ErrorContext = {
          wallet: options.wallet,
          chain: options.chain,
          contract: programId,
          functionName: prop,
          args: instructionArgs,
          ...(options.enrichContext?.(prop, instructionArgs) ?? {}),
        };
        return wrapBuilder(builder, ctx, options);
      };
    },
  });

  // Return the original program with .methods swapped for the wrapped one. We don't
  // proxy the whole program because Anchor reads many internals off it (provider, idl,
  // coder, account namespace) — wrapping them all is brittle and most aren't a useful
  // tracking surface anyway.
  return new Proxy(program, {
    get(target, prop, receiver) {
      if (prop === 'methods') return wrappedMethods;
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

const TERMINAL_METHODS = new Set(['rpc', 'simulate', 'transaction', 'instruction', 'signers']);

function wrapBuilder(
  builder: object,
  ctx: Web3ErrorContext,
  options: WrapAnchorProgramOptions,
): object {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;

      if (!TERMINAL_METHODS.has(prop)) {
        // Builder methods (.accounts, .signers, .preInstructions, ...) chain — wrap each
        // one's return value too so the terminal call eventually goes through us.
        return (...args: unknown[]) => {
          const next = Reflect.apply(value, target, args);
          if (next && typeof next === 'object') return wrapBuilder(next, ctx, options);
          return next;
        };
      }

      // Terminal call. .rpc() / .simulate() / .transaction() — instrument it.
      return async (...args: unknown[]) => {
        try {
          const result = await Reflect.apply(value, target, args);
          if (options.recordSuccess !== false) {
            const sig = typeof result === 'string' ? result : undefined;
            recordTxBreadcrumb({
              kind: prop === 'simulate' ? 'simulate' : 'tx',
              message: `${ctx.functionName}.${prop}${sig ? ` → ${truncate(sig)}` : ''}`,
              context: ctx,
              result: sig,
              extras: { anchorTerminal: prop },
            });
          }
          return result;
        } catch (error) {
          captureWeb3Error(error, { ...ctx, extra: { anchorTerminal: prop } });
          throw error;
        }
      };
    },
  });
}

function truncate(s: string): string {
  return s.length > 14 ? `${s.slice(0, 10)}…${s.slice(-4)}` : s;
}
