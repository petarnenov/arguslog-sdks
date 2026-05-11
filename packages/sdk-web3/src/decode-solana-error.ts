import { jsonSafe } from './decode-viem-error.js';
import type { DecodedWeb3Error, Web3ErrorKind } from './types.js';

/**
 * Decodes Solana errors from the three libraries customers actually use:
 *
 * <ul>
 *   <li>{@code @solana/web3.js} — {@code SendTransactionError} carrying {@code logs} +
 *       {@code signature}, generic {@code RpcError} from the JSON-RPC layer.</li>
 *   <li>{@code @solana/wallet-adapter-base} (& descendants) — {@code WalletSignTransactionError},
 *       {@code WalletNotConnectedError}, etc. User-rejection lives in the {@code .cause} or
 *       in the message.</li>
 *   <li>{@code @coral-xyz/anchor} — {@code AnchorError} with {@code _isAnchorError: true},
 *       structured {@code error.errorCode.code/number} + {@code error.errorMessage}, plus
 *       Anchor-specific {@code errorLogs}.</li>
 * </ul>
 *
 * <p>Solana programs don't have a notion of "revert reason" the way EVM does; instead they
 * leave traces in transaction logs. {@code Program log: AnchorError caused by …}, {@code
 * custom program error: 0x1f4}, etc. We parse those out so the dashboard sees the program
 * id, the error code, and the human-readable message — same depth-of-info as a viem
 * {@code ContractFunctionRevertedError}.
 */
export function decodeSolanaError(error: unknown): DecodedWeb3Error | undefined {
  if (!isObject(error)) return undefined;

  // Anchor errors — most specific, check first.
  if (error['_isAnchorError'] === true || isAnchorErrorShape(error)) {
    return decodeAnchorError(error);
  }

  const name = readString(error, 'name');

  // Wallet adapter errors. Hierarchy: WalletError → WalletSignTransactionError /
  // WalletSendTransactionError / WalletNotConnectedError / WalletConnectionError / etc.
  if (typeof name === 'string' && name.startsWith('Wallet') && name.endsWith('Error')) {
    return decodeWalletAdapterError(name, error);
  }

  // SendTransactionError from @solana/web3.js — carries .logs + .signature + .transactionMessage.
  if (name === 'SendTransactionError' || hasSendTransactionShape(error)) {
    return decodeSendTransactionError(error);
  }

  // ConfirmTransactionError shape — typically wraps a SendTransactionError or has its own
  // error code in the JSON-RPC response.
  if (
    name === 'TransactionExpiredBlockheightExceededError' ||
    matchMessage(error, /BlockheightExceeded|block height exceeded/i)
  ) {
    return solanaErr('solana.blockhashExpired', 'Blockhash expired before confirmation', error);
  }
  if (
    name === 'TransactionExpiredTimeoutError' ||
    matchMessage(error, /transaction was not confirmed/i)
  ) {
    return solanaErr('rpc.timeout', 'Transaction confirmation timed out', error);
  }

  // Solana JSON-RPC errors have an `InstructionError` shape: ['InstructionError', [index, { Custom: code }]]
  // commonly seen as the root .err on a failed Connection.simulateTransaction result wrapped
  // into a thrown error. We pluck whatever's there.
  const transactionError = readObject(error, 'transactionError') ?? readObject(error, 'err');
  if (transactionError) {
    const decoded = decodeTransactionError(transactionError);
    if (decoded) return enrichWithLogs(decoded, error);
  }

  // String-message based heuristics — last-resort matching against well-known Solana RPC text.
  if (matchMessage(error, /InsufficientFundsForRent|insufficient lamports/i)) {
    return solanaErr('solana.insufficientLamports', 'Insufficient lamports', error);
  }
  if (matchMessage(error, /computational budget exceeded|exceeded.*compute.*units/i)) {
    return solanaErr('solana.computeBudgetExceeded', 'Compute budget exceeded', error);
  }
  if (matchMessage(error, /Simulation failed|preflight failure/i)) {
    return solanaErr('solana.simulationFailed', 'Transaction simulation failed', error);
  }
  if (matchMessage(error, /429|rate.?limit/i)) {
    return solanaErr('rpc.rateLimit', 'RPC rate limited', error);
  }

  return undefined;
}

// ── Anchor ─────────────────────────────────────────────────────────────────────────────────

function isAnchorErrorShape(err: Record<string, unknown>): boolean {
  const inner = readObject(err, 'error');
  if (!inner) return false;
  return readObject(inner, 'errorCode') !== undefined && typeof inner['errorMessage'] === 'string';
}

function decodeAnchorError(error: Record<string, unknown>): DecodedWeb3Error {
  const inner = readObject(error, 'error') ?? error;
  const errorCode = readObject(inner, 'errorCode');
  const code = errorCode ? readString(errorCode, 'code') : undefined;
  const number = errorCode ? readNumber(errorCode, 'number') : undefined;
  const errorMessage = readString(inner, 'errorMessage');
  const origin = readString(inner, 'origin');
  const comparedValues = inner['comparedValues'];
  const programId = readString(inner, 'programId') ?? readProgramFromLogs(error);
  const errorLogs = readArray(error, 'errorLogs');
  const logs = readArray(error, 'logs');

  const data: Record<string, unknown> = {
    errorCode: code,
    errorNumber: number,
    errorMessage,
  };
  if (origin !== undefined) data.origin = origin;
  if (comparedValues !== undefined) data.comparedValues = jsonSafe(comparedValues);
  if (programId) data.programId = programId;
  if (errorLogs && errorLogs.length > 0) data.errorLogs = errorLogs.slice(0, 20);
  if (logs && logs.length > 0) data.logs = logs.slice(0, 50);

  return {
    kind: 'solana.anchorError',
    shortMessage: code
      ? `${code}${errorMessage ? ': ' + errorMessage : ''}`
      : (errorMessage ?? 'Anchor error'),
    data,
    source: 'anchor',
  };
}

// ── Wallet adapter ─────────────────────────────────────────────────────────────────────────

function decodeWalletAdapterError(name: string, error: Record<string, unknown>): DecodedWeb3Error {
  if (name === 'WalletNotConnectedError' || name === 'WalletNotReadyError') {
    return solWalletErr('wallet.notConnected', 'Wallet not connected', error);
  }
  if (name === 'WalletConnectionError') {
    return solWalletErr(
      'wallet.notConnected',
      readString(error, 'message') ?? 'Wallet connection failed',
      error,
    );
  }
  // Sign / send rejected — adapter wraps the rejection in `cause` or in the message.
  if (
    name === 'WalletSignTransactionError' ||
    name === 'WalletSendTransactionError' ||
    name === 'WalletSignMessageError' ||
    name === 'WalletSignInError'
  ) {
    if (isUserRejection(error)) {
      return solWalletErr('user.rejected', 'User rejected wallet request', error);
    }
    return solWalletErr('solana.programError', readString(error, 'message') ?? name, error);
  }
  // Unknown wallet error — surface name to keep the dashboard useful.
  return solWalletErr('unknown', readString(error, 'message') ?? name, error, { errorName: name });
}

function isUserRejection(error: Record<string, unknown>): boolean {
  const message = readString(error, 'message') ?? '';
  if (/user rejected|rejected the request|user denied/i.test(message)) return true;
  const cause = error['cause'];
  if (isObject(cause)) {
    const cm = readString(cause, 'message') ?? '';
    if (/user rejected|rejected the request|user denied/i.test(cm)) return true;
    if (readNumber(cause, 'code') === 4001) return true;
  }
  return false;
}

function solWalletErr(
  kind: Web3ErrorKind,
  shortMessage: string,
  error: Record<string, unknown>,
  extras?: Record<string, unknown>,
): DecodedWeb3Error {
  const data: Record<string, unknown> = {};
  const message = readString(error, 'message');
  if (message) data.message = message;
  const cause = error['cause'];
  if (isObject(cause)) {
    const causeMessage = readString(cause, 'message');
    if (causeMessage) data.causeMessage = causeMessage;
    const causeCode = readNumber(cause, 'code');
    if (causeCode !== undefined) data.causeCode = causeCode;
  }
  if (extras) Object.assign(data, extras);
  return { kind, shortMessage, data, source: 'solana-wallet' };
}

// ── SendTransactionError ───────────────────────────────────────────────────────────────────

function hasSendTransactionShape(err: Record<string, unknown>): boolean {
  return Array.isArray(err['logs']) && typeof err['signature'] === 'string';
}

function decodeSendTransactionError(error: Record<string, unknown>): DecodedWeb3Error {
  const logs = readArray(error, 'logs') ?? [];
  const signature = readString(error, 'signature');
  const transactionError = readObject(error, 'transactionError') ?? readObject(error, 'err');

  // Try Anchor first — its log line is the most informative.
  const anchorFromLogs = parseAnchorErrorFromLogs(logs);
  if (anchorFromLogs) {
    return enrichWithLogs(anchorFromLogs, { logs, signature });
  }

  const customError = parseCustomErrorFromLogs(logs);
  if (customError) {
    return enrichWithLogs(customError, { logs, signature });
  }

  // Nothing pretty in logs — surface the JSON-RPC InstructionError + signature.
  let decoded: DecodedWeb3Error | undefined;
  if (transactionError) {
    decoded = decodeTransactionError(transactionError);
  }
  if (decoded) {
    return enrichWithLogs(decoded, { logs, signature });
  }

  return enrichWithLogs(
    solanaErr(
      'solana.programError',
      readString(error, 'message') ?? 'Solana transaction failed',
      error,
    ),
    { logs, signature },
  );
}

function decodeTransactionError(err: unknown): DecodedWeb3Error | undefined {
  // Solana RPC encodes InstructionError as: { InstructionError: [index, errVariant] }
  // errVariant can be a string ("AccountInUse") or { Custom: number }.
  if (Array.isArray(err)) {
    if (err[0] === 'InstructionError') {
      const detail = err[1];
      if (Array.isArray(detail)) {
        const [index, variant] = detail as [number, unknown];
        if (isObject(variant) && 'Custom' in variant) {
          return {
            kind: 'solana.programError',
            shortMessage: `Custom program error 0x${(variant as { Custom: number }).Custom.toString(16)}`,
            data: {
              instructionIndex: index,
              customErrorCode: (variant as { Custom: number }).Custom,
            },
            source: 'solana',
          };
        }
        if (typeof variant === 'string') {
          return {
            kind: 'solana.programError',
            shortMessage: `${variant} (instruction ${index})`,
            data: { instructionIndex: index, variant },
            source: 'solana',
          };
        }
      }
    }
  }
  if (isObject(err)) {
    if ('InstructionError' in err)
      return decodeTransactionError(['InstructionError', err['InstructionError']]);
    if ('InsufficientFundsForRent' in err) {
      return {
        kind: 'solana.insufficientLamports',
        shortMessage: 'Insufficient lamports for rent',
        data: jsonSafe(err) as Record<string, unknown>,
        source: 'solana',
      };
    }
  }
  return undefined;
}

// ── Log parsers ────────────────────────────────────────────────────────────────────────────

const ANCHOR_LOG_RE =
  /AnchorError(?:\s+caused by account: (\S+))?\.\s*Error Code:\s*(\w+)\.\s*Error Number:\s*(\d+)\.\s*Error Message:\s*(.+?)\.?\s*$/;

function parseAnchorErrorFromLogs(logs: unknown[]): DecodedWeb3Error | undefined {
  for (const raw of logs) {
    if (typeof raw !== 'string') continue;
    const m = raw.match(ANCHOR_LOG_RE);
    if (!m) continue;
    const [, origin, code, numberStr, message] = m;
    const data: Record<string, unknown> = {
      errorCode: code,
      errorNumber: numberStr ? Number.parseInt(numberStr, 10) : undefined,
      errorMessage: message,
    };
    if (origin) data.origin = origin;
    return {
      kind: 'solana.anchorError',
      shortMessage: code ? `${code}: ${message}` : (message ?? 'Anchor error'),
      data,
      source: 'anchor',
    };
  }
  return undefined;
}

const CUSTOM_ERROR_LOG_RE = /Program (\S+) failed: custom program error: 0x([0-9a-fA-F]+)/;

function parseCustomErrorFromLogs(logs: unknown[]): DecodedWeb3Error | undefined {
  for (const raw of logs) {
    if (typeof raw !== 'string') continue;
    const m = raw.match(CUSTOM_ERROR_LOG_RE);
    if (!m) continue;
    const [, programId, hexCode] = m!;
    const code = Number.parseInt(hexCode!, 16);
    return {
      kind: 'solana.programError',
      shortMessage: `Custom program error 0x${hexCode!} (${code})`,
      data: { programId, customErrorCode: code, customErrorHex: `0x${hexCode!}` },
      source: 'solana',
    };
  }
  return undefined;
}

function readProgramFromLogs(error: Record<string, unknown>): string | undefined {
  const logs = readArray(error, 'logs') ?? readArray(error, 'errorLogs');
  if (!logs) return undefined;
  for (const raw of logs) {
    if (typeof raw !== 'string') continue;
    const m = raw.match(/Program (\S+) (?:invoke|failed)/);
    if (m) return m[1];
  }
  return undefined;
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────

function solanaErr(
  kind: Web3ErrorKind,
  shortMessage: string,
  error: Record<string, unknown>,
  extras?: Record<string, unknown>,
): DecodedWeb3Error {
  const data: Record<string, unknown> = {};
  const message = readString(error, 'message');
  if (message) data.message = message;
  if (extras) Object.assign(data, extras);
  return { kind, shortMessage, data, source: 'solana' };
}

function enrichWithLogs(
  decoded: DecodedWeb3Error,
  source: Record<string, unknown>,
): DecodedWeb3Error {
  const logs = readArray(source, 'logs');
  const signature = readString(source, 'signature');
  if (logs && logs.length > 0 && decoded.data.logs === undefined) {
    decoded.data.logs = logs.slice(0, 50);
  }
  if (signature && decoded.data.signature === undefined) {
    decoded.data.signature = signature;
  }
  return decoded;
}

function matchMessage(error: Record<string, unknown>, re: RegExp): boolean {
  const message = readString(error, 'message');
  return typeof message === 'string' && re.test(message);
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

function readArray(obj: Record<string, unknown>, key: string): unknown[] | undefined {
  const v = obj[key];
  return Array.isArray(v) ? v : undefined;
}
