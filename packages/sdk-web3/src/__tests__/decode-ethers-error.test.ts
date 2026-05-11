import { describe, expect, it } from 'vitest';

import { decodeEthersError } from '../decode-ethers-error.js';

describe('decodeEthersError', () => {
  it('returns undefined when error has no `code`', () => {
    expect(decodeEthersError({ message: 'plain' })).toBeUndefined();
    expect(decodeEthersError(undefined)).toBeUndefined();
  });

  it('maps ACTION_REJECTED → user.rejected', () => {
    const out = decodeEthersError({ code: 'ACTION_REJECTED', shortMessage: 'rejected' });
    expect(out?.kind).toBe('user.rejected');
    expect(out?.source).toBe('ethers');
  });

  it('maps CALL_EXCEPTION → contract.reverted with reason + revert data', () => {
    const out = decodeEthersError({
      code: 'CALL_EXCEPTION',
      shortMessage: 'execution reverted',
      reason: 'ERC20InsufficientBalance',
      data: '0x...',
      revert: { name: 'ERC20InsufficientBalance' },
    });
    expect(out?.kind).toBe('contract.reverted');
    expect(out?.data.reason).toBe('ERC20InsufficientBalance');
    expect(out?.data.errorName).toBe('ERC20InsufficientBalance');
    expect(out?.data.code).toBe('CALL_EXCEPTION');
  });

  it('maps INSUFFICIENT_FUNDS → tx.insufficientFunds with transaction info', () => {
    const out = decodeEthersError({
      code: 'INSUFFICIENT_FUNDS',
      shortMessage: 'insufficient funds',
      transaction: { to: '0xabc', from: '0xdef', value: 1000n, gasLimit: 21000n },
    });
    expect(out?.kind).toBe('tx.insufficientFunds');
    expect(out?.data.transaction).toMatchObject({ to: '0xabc', from: '0xdef' });
  });

  it('maps NONCE_EXPIRED', () => {
    const out = decodeEthersError({ code: 'NONCE_EXPIRED' });
    expect(out?.kind).toBe('tx.nonceExpired');
  });

  it('maps UNPREDICTABLE_GAS_LIMIT → gas.estimateFailed', () => {
    const out = decodeEthersError({ code: 'UNPREDICTABLE_GAS_LIMIT' });
    expect(out?.kind).toBe('gas.estimateFailed');
  });

  it('maps NETWORK_ERROR / TIMEOUT → rpc.timeout', () => {
    expect(decodeEthersError({ code: 'NETWORK_ERROR' })?.kind).toBe('rpc.timeout');
    expect(decodeEthersError({ code: 'TIMEOUT' })?.kind).toBe('rpc.timeout');
    expect(decodeEthersError({ code: 'SERVER_ERROR' })?.kind).toBe('rpc.timeout');
  });

  it('maps REPLACEMENT_UNDERPRICED', () => {
    const out = decodeEthersError({ code: 'REPLACEMENT_UNDERPRICED' });
    expect(out?.kind).toBe('tx.replacementUnderpriced');
  });

  it('maps unknown ethers code as kind=unknown but keeps code', () => {
    const out = decodeEthersError({ code: 'TOTALLY_NEW_CODE', message: 'whatever' });
    expect(out?.kind).toBe('unknown');
    expect(out?.data.code).toBe('TOTALLY_NEW_CODE');
  });
});
