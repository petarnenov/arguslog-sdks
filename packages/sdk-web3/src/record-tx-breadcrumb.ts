import { addBreadcrumb } from '@arguslog/sdk-browser';

import { jsonSafe } from './decode-viem-error.js';
import type { Web3ErrorContext } from './types.js';

/**
 * Emits a {@code web3.tx} breadcrumb for a SUCCESSFUL Web3 action — the success-path twin of
 * {@code captureWeb3Error}. Used by every auto-wrap helper in the SDK so the breadcrumb
 * timeline shows both successful txs and failed ones in the same shape, level info.
 *
 * <p>The dashboard then reads as a coherent story when an error finally fires: every
 * preceding successful transaction sits in the timeline above the failure, with the same
 * chain / wallet / contract structure attached.
 */
export function recordTxBreadcrumb(opts: {
  message: string;
  context: Web3ErrorContext;
  /** Optional result identifier — tx hash for EVM, signature for Solana. */
  result?: string;
  /** Sub-category — defaults to {@code 'tx'}; use {@code 'sign'} for signMessage / signTypedData. */
  kind?: 'tx' | 'sign' | 'simulate' | 'confirm' | 'read' | 'switch';
  extras?: Record<string, unknown>;
}): void {
  const { message, context, result, kind = 'tx', extras } = opts;
  try {
    addBreadcrumb({
      category: `web3.${kind}`,
      level: 'info',
      message,
      data: {
        chain: context.chain,
        wallet: context.wallet,
        contract: context.contract,
        functionName: context.functionName,
        args: context.args ? jsonSafe(context.args) : undefined,
        account: context.account,
        result,
        ...(extras ?? {}),
      },
    });
  } catch {
    // best-effort
  }
}
