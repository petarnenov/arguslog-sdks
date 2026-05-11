import { jsonSafe } from './decode-viem-error.js';
import type { DecodedWeb3Error, Web3ErrorKind } from './types.js';

/**
 * ethers v6 errors carry a stable {@code code} field (the canonical ones below) plus optional
 * {@code shortMessage}, {@code reason}, {@code data}, {@code transaction}, {@code receipt}.
 * We map {@code code} → {@link Web3ErrorKind} and forward the remaining fields onto the
 * decoded payload so the dashboard sees the same rich shape as viem-decoded errors.
 *
 * <p>Documented codes (ethers/utils/errors.ts):
 *
 * <ul>
 *   <li>{@code ACTION_REJECTED} — user rejected the request in the wallet</li>
 *   <li>{@code INSUFFICIENT_FUNDS}</li>
 *   <li>{@code NONCE_EXPIRED}</li>
 *   <li>{@code REPLACEMENT_UNDERPRICED}</li>
 *   <li>{@code UNPREDICTABLE_GAS_LIMIT} — gas estimate failed (often a revert)</li>
 *   <li>{@code CALL_EXCEPTION} — contract reverted on call/static call</li>
 *   <li>{@code TRANSACTION_REPLACED}</li>
 *   <li>{@code NETWORK_ERROR}</li>
 *   <li>{@code SERVER_ERROR}</li>
 *   <li>{@code TIMEOUT}</li>
 * </ul>
 */
export function decodeEthersError(error: unknown): DecodedWeb3Error | undefined {
  if (!isObject(error)) return undefined;
  const code = readString(error, 'code');
  if (!code) return undefined;

  const mapping: Record<string, [Web3ErrorKind, string]> = {
    ACTION_REJECTED: ['user.rejected', 'User rejected request'],
    INSUFFICIENT_FUNDS: ['tx.insufficientFunds', 'Insufficient funds'],
    NONCE_EXPIRED: ['tx.nonceExpired', 'Nonce expired'],
    REPLACEMENT_UNDERPRICED: ['tx.replacementUnderpriced', 'Replacement underpriced'],
    UNPREDICTABLE_GAS_LIMIT: ['gas.estimateFailed', 'Gas estimation failed'],
    CALL_EXCEPTION: ['contract.reverted', 'Contract call reverted'],
    NETWORK_ERROR: ['rpc.timeout', 'Network error'],
    SERVER_ERROR: ['rpc.timeout', 'RPC server error'],
    TIMEOUT: ['rpc.timeout', 'RPC timeout'],
  };
  const tuple = mapping[code];
  if (!tuple) {
    // ethers code we don't have a canonical mapping for — surface as 'unknown' with the code
    // preserved so dashboards can still group on it.
    return {
      kind: 'unknown',
      shortMessage: readString(error, 'shortMessage') ?? code,
      data: { code, message: readString(error, 'message') ?? '' },
      source: 'ethers',
    };
  }

  const [kind, defaultMessage] = tuple;
  const data: Record<string, unknown> = { code };
  const reason = readString(error, 'reason');
  if (reason) data.reason = reason;
  const message = readString(error, 'message');
  if (message) data.message = message;
  const dataField = error['data'];
  if (dataField !== undefined) data.revertData = jsonSafe(dataField);
  const tx = error['transaction'];
  if (isObject(tx)) {
    data.transaction = jsonSafe({
      to: tx['to'],
      from: tx['from'],
      value: tx['value'],
      gasLimit: tx['gasLimit'],
    });
  }
  const receipt = error['receipt'];
  if (isObject(receipt)) {
    data.receipt = jsonSafe({
      transactionHash: receipt['transactionHash'] ?? receipt['hash'],
      status: receipt['status'],
      gasUsed: receipt['gasUsed'],
    });
  }

  // CALL_EXCEPTION can carry an ABI-decoded revertName (ethers v6 ContractRunner attempts the
  // decode for us). Surface it the same way the viem path surfaces ContractFunctionRevertedError.
  if (code === 'CALL_EXCEPTION') {
    const revert = readString(error, 'revert');
    const revertName =
      error['revert'] && isObject(error['revert'])
        ? readString(error['revert'] as Record<string, unknown>, 'name')
        : undefined;
    if (revertName) data.errorName = revertName;
    if (revert) data.revertSignature = revert;
  }

  return {
    kind,
    shortMessage: readString(error, 'shortMessage') ?? defaultMessage,
    data,
    source: 'ethers',
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}
