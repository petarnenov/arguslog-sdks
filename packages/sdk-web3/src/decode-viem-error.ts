import type { DecodedWeb3Error, Web3ErrorKind } from './types.js';

/**
 * Maps viem's typed error hierarchy to a normalised {@link DecodedWeb3Error}. We don't import
 * viem types directly — the package is a peer dep, may not be installed in the consumer's tree
 * — so we go by {@code error.name} (viem stamps these reliably) and read fields off the
 * structural shape we know each variant carries.
 *
 * <p>References (viem error names that appear here):
 *
 * <ul>
 *   <li>{@code ContractFunctionRevertedError} — has {@code data.errorName} + {@code data.args}
 *       when revert was a custom error decoded against the ABI.</li>
 *   <li>{@code ContractFunctionExecutionError} — wrapper carrying the inner reverted error in
 *       {@code .cause}.</li>
 *   <li>{@code UserRejectedRequestError} — user clicked reject in the wallet popup. Should be
 *       INFO level, not ERROR — happens by design constantly.</li>
 *   <li>{@code ChainMismatchError} — wallet on different chain than expected.</li>
 *   <li>{@code TransactionExecutionError} — generic execution failure (out of gas, etc.).</li>
 *   <li>{@code EstimateGasExecutionError} — gas estimation reverted.</li>
 *   <li>{@code RpcRequestError} / {@code HttpRequestError} — network layer.</li>
 * </ul>
 */
export function decodeViemError(error: unknown): DecodedWeb3Error | undefined {
  if (!isObject(error)) return undefined;
  // viem stamps a `name` on every typed error. Walk down `.cause` chain too — the outer
  // ContractFunctionExecutionError often wraps the more specific Reverted variant.
  const stack = unwrapCauseChain(error);

  for (const err of stack) {
    const name = readString(err, 'name');
    if (!name) continue;

    if (name === 'UserRejectedRequestError') {
      return decoded('user.rejected', readString(err, 'shortMessage') ?? 'User rejected', err);
    }
    if (name === 'ContractFunctionRevertedError') {
      const data = readObject(err, 'data');
      const errorName = data ? readString(data, 'errorName') : undefined;
      const args = data && 'args' in data ? jsonSafe(data.args) : undefined;
      const reason = readString(err, 'reason');
      return decoded(
        'contract.reverted',
        errorName ? `Reverted: ${errorName}` : reason ? `Reverted: ${reason}` : 'Contract reverted',
        err,
        { errorName, args, reason },
      );
    }
    if (name === 'ChainMismatchError') {
      return decoded(
        'chain.mismatch',
        readString(err, 'shortMessage') ?? 'Chain mismatch',
        err,
        {
          chainId: readNumber(err, 'currentChainId'),
          expectedChainId: readNumber(err, 'chainId'),
        },
      );
    }
    if (name === 'EstimateGasExecutionError') {
      return decoded('gas.estimateFailed', 'Gas estimation failed', err);
    }
    if (name === 'TransactionExecutionError') {
      return decoded(
        'tx.executionFailed',
        readString(err, 'shortMessage') ?? 'Transaction execution failed',
        err,
      );
    }
    if (name === 'NonceTooLowError' || name === 'NonceTooHighError') {
      return decoded('tx.nonceExpired', readString(err, 'shortMessage') ?? name, err);
    }
    if (name === 'TransactionRejectedRpcError') {
      return decoded('user.rejected', 'Transaction rejected', err);
    }
    if (name === 'InsufficientFundsError') {
      return decoded(
        'tx.insufficientFunds',
        readString(err, 'shortMessage') ?? 'Insufficient funds',
        err,
      );
    }
    if (name === 'RpcRequestError' || name === 'HttpRequestError') {
      const status = readNumber(err, 'status');
      if (status === 429) {
        return decoded('rpc.rateLimit', 'RPC rate limited (429)', err, { status });
      }
      return decoded('rpc.timeout', readString(err, 'shortMessage') ?? 'RPC error', err, {
        status,
      });
    }
    if (name === 'InvalidParamsRpcError') {
      return decoded('rpc.invalidParams', 'Invalid RPC params', err);
    }
  }

  // Fallback — viem error but unrecognised name. Still helpful to capture as 'unknown' with the
  // name preserved so we can extend the mapping later without losing data.
  const top = stack[0]!;
  const topName = readString(top, 'name');
  if (topName?.endsWith('Error') && readString(top, 'shortMessage') !== undefined) {
    return decoded('unknown', readString(top, 'shortMessage') ?? topName, top, { errorName: topName });
  }
  return undefined;
}

function decoded(
  kind: Web3ErrorKind,
  shortMessage: string,
  error: Record<string, unknown>,
  extras?: Record<string, unknown>,
): DecodedWeb3Error {
  const data: Record<string, unknown> = {};
  const message = readString(error, 'message');
  if (message) data.message = message;
  const cause = error['cause'];
  if (cause && typeof cause === 'object') {
    const causeName = readString(cause as Record<string, unknown>, 'name');
    if (causeName) data.causeName = causeName;
  }
  const docsPath = readString(error, 'docsPath');
  if (docsPath) data.docsPath = docsPath;
  const metaMessages = error['metaMessages'];
  if (Array.isArray(metaMessages) && metaMessages.length > 0) {
    data.metaMessages = metaMessages.slice(0, 5).map((m) => String(m));
  }
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (v !== undefined) data[k] = jsonSafe(v);
    }
  }
  return { kind, shortMessage, data, source: 'viem' };
}

function unwrapCauseChain(error: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let cursor: unknown = error;
  let guard = 0;
  while (isObject(cursor) && guard++ < 10) {
    out.push(cursor);
    cursor = cursor['cause'];
  }
  return out;
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

function readObject(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = obj[key];
  return isObject(v) ? v : undefined;
}

/** Recursively converts bigints to strings so JSON.stringify on the breadcrumb data won't throw. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}
