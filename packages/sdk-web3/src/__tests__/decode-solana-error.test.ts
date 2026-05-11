import { describe, expect, it } from 'vitest';

import { decodeSolanaError } from '../decode-solana-error.js';

/**
 * Solana errors come in three shapes — Anchor (typed), wallet adapter (named), and raw
 * SendTransactionError with logs. The tests cover each branch + the log-string parsers
 * (Anchor format, custom program error hex code) without requiring @solana/web3.js or
 * @coral-xyz/anchor at test time — duck-typed objects mirror the real shapes.
 */
describe('decodeSolanaError', () => {
  // ── Anchor ─────────────────────────────────────────────────────────────────────────────

  it('decodes a structured AnchorError with errorCode + message', () => {
    const error = {
      _isAnchorError: true,
      error: {
        errorCode: { code: 'ConstraintHasOne', number: 6001 },
        errorMessage: 'A has one constraint was violated',
        origin: 'token_account',
      },
      logs: ['Program log: AnchorError caused by …'],
    };
    const out = decodeSolanaError(error);
    expect(out).toMatchObject({
      kind: 'solana.anchorError',
      source: 'anchor',
      shortMessage: expect.stringContaining('ConstraintHasOne'),
      data: expect.objectContaining({
        errorCode: 'ConstraintHasOne',
        errorNumber: 6001,
        errorMessage: 'A has one constraint was violated',
        origin: 'token_account',
      }),
    });
  });

  it('parses an AnchorError out of program logs when no _isAnchorError flag is set', () => {
    const error = {
      name: 'SendTransactionError',
      message: 'failed to send tx',
      signature: 'sig123',
      logs: [
        'Program ABC invoke [1]',
        'Program log: Instruction: SwapTokens',
        'Program log: AnchorError caused by account: pool. Error Code: SlippageExceeded. Error Number: 6010. Error Message: Slippage tolerance exceeded.',
        'Program ABC failed: custom program error: 0x177a',
      ],
    };
    const out = decodeSolanaError(error);
    expect(out?.kind).toBe('solana.anchorError');
    expect(out?.data.errorCode).toBe('SlippageExceeded');
    expect(out?.data.errorNumber).toBe(6010);
    expect(out?.data.origin).toBe('pool');
    expect(out?.data.signature).toBe('sig123');
    expect(out?.data.logs).toBeDefined();
  });

  // ── Wallet adapter ────────────────────────────────────────────────────────────────────

  it('decodes WalletNotConnectedError', () => {
    const out = decodeSolanaError({ name: 'WalletNotConnectedError', message: 'Not connected' });
    expect(out).toMatchObject({
      kind: 'wallet.notConnected',
      source: 'solana-wallet',
    });
  });

  it('decodes user-rejection inside WalletSignTransactionError via cause.code 4001', () => {
    const error = {
      name: 'WalletSignTransactionError',
      message: 'Sign failed',
      cause: { code: 4001, message: 'User rejected the request' },
    };
    const out = decodeSolanaError(error);
    expect(out?.kind).toBe('user.rejected');
    expect(out?.data.causeCode).toBe(4001);
  });

  it('decodes user-rejection via message regex', () => {
    const error = {
      name: 'WalletSignTransactionError',
      message: 'User rejected the request',
    };
    expect(decodeSolanaError(error)?.kind).toBe('user.rejected');
  });

  it('treats non-rejection wallet sign errors as solana.programError', () => {
    const error = {
      name: 'WalletSignTransactionError',
      message: 'Wallet timed out signing',
    };
    expect(decodeSolanaError(error)?.kind).toBe('solana.programError');
  });

  // ── SendTransactionError + log parsing ────────────────────────────────────────────────

  it('decodes a custom program error from logs', () => {
    const error = {
      name: 'SendTransactionError',
      message: 'failed',
      signature: 'sig456',
      logs: [
        'Program 11111111111111111111111111111111 invoke [1]',
        'Program 11111111111111111111111111111111 failed: custom program error: 0x1f4',
      ],
    };
    const out = decodeSolanaError(error);
    expect(out?.kind).toBe('solana.programError');
    expect(out?.data.programId).toBe('11111111111111111111111111111111');
    expect(out?.data.customErrorCode).toBe(500);
    expect(out?.data.customErrorHex).toBe('0x1f4');
    expect(out?.data.signature).toBe('sig456');
  });

  it('decodes InstructionError Custom variant from transactionError', () => {
    const error = {
      name: 'SendTransactionError',
      logs: [],
      signature: 'sigX',
      transactionError: ['InstructionError', [0, { Custom: 6 }]],
    };
    const out = decodeSolanaError(error);
    expect(out?.kind).toBe('solana.programError');
    expect(out?.data.customErrorCode).toBe(6);
    expect(out?.data.instructionIndex).toBe(0);
  });

  // ── Heuristic message matchers ────────────────────────────────────────────────────────

  it('flags blockhash expired', () => {
    const error = { name: 'TransactionExpiredBlockheightExceededError', message: 'block height exceeded' };
    expect(decodeSolanaError(error)?.kind).toBe('solana.blockhashExpired');
  });

  it('flags compute budget exceeded', () => {
    const error = { message: 'computational budget exceeded' };
    expect(decodeSolanaError(error)?.kind).toBe('solana.computeBudgetExceeded');
  });

  it('flags simulation failure', () => {
    const error = { message: 'Simulation failed: AccountNotFound' };
    expect(decodeSolanaError(error)?.kind).toBe('solana.simulationFailed');
  });

  it('flags insufficient lamports', () => {
    const error = { message: 'Transfer: insufficient lamports' };
    expect(decodeSolanaError(error)?.kind).toBe('solana.insufficientLamports');
  });

  it('returns undefined for non-Solana errors', () => {
    expect(decodeSolanaError(undefined)).toBeUndefined();
    expect(decodeSolanaError('plain')).toBeUndefined();
    expect(decodeSolanaError({ message: 'something' })).toBeUndefined();
    expect(decodeSolanaError({ name: 'TypeError' })).toBeUndefined();
  });
});
