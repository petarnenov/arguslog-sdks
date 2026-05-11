import { describe, expect, it } from 'vitest';

import { decodeViemError } from '../decode-viem-error.js';

/**
 * viem stamps {@code name} on every typed error, so the decoder is identity-on-name. The
 * tests build minimal duck-typed objects that match the shape viem ships and verify the
 * decoder picks them up. Keeps the test independent of an installed viem.
 */
describe('decodeViemError', () => {
  it('returns undefined for non-Error inputs', () => {
    expect(decodeViemError(undefined)).toBeUndefined();
    expect(decodeViemError(null)).toBeUndefined();
    expect(decodeViemError('plain string')).toBeUndefined();
    expect(decodeViemError(42)).toBeUndefined();
  });

  it('decodes UserRejectedRequestError as user.rejected', () => {
    const error = {
      name: 'UserRejectedRequestError',
      shortMessage: 'User rejected the request.',
      message: '...long...',
    };
    const out = decodeViemError(error);
    expect(out).toMatchObject({
      kind: 'user.rejected',
      shortMessage: 'User rejected the request.',
      source: 'viem',
    });
  });

  it('decodes ContractFunctionRevertedError with errorName + args', () => {
    const error = {
      name: 'ContractFunctionRevertedError',
      reason: 'ERC20InsufficientBalance',
      data: { errorName: 'ERC20InsufficientBalance', args: ['0xSender', 50n, 100n] },
      message: 'reverted',
    };
    const out = decodeViemError(error);
    expect(out?.kind).toBe('contract.reverted');
    expect(out?.shortMessage).toContain('ERC20InsufficientBalance');
    expect(out?.data.errorName).toBe('ERC20InsufficientBalance');
    expect(out?.data.args).toEqual(['0xSender', '50', '100']); // bigints stringified
  });

  it('walks the cause chain for wrapped contract errors', () => {
    const inner = {
      name: 'ContractFunctionRevertedError',
      data: { errorName: 'Slippage' },
    };
    const wrapper = {
      name: 'ContractFunctionExecutionError',
      shortMessage: 'execution reverted',
      cause: inner,
    };
    const out = decodeViemError(wrapper);
    expect(out?.kind).toBe('contract.reverted');
    expect(out?.data.errorName).toBe('Slippage');
  });

  it('decodes ChainMismatchError', () => {
    const error = {
      name: 'ChainMismatchError',
      shortMessage: 'Chain mismatch',
      currentChainId: 1,
      chainId: 137,
    };
    const out = decodeViemError(error);
    expect(out).toMatchObject({
      kind: 'chain.mismatch',
      data: expect.objectContaining({ chainId: 1, expectedChainId: 137 }),
    });
  });

  it('decodes RpcRequestError with status 429 as rate limit', () => {
    const error = {
      name: 'RpcRequestError',
      shortMessage: 'Rate limited',
      status: 429,
    };
    const out = decodeViemError(error);
    expect(out?.kind).toBe('rpc.rateLimit');
  });

  it('decodes EstimateGasExecutionError', () => {
    const error = { name: 'EstimateGasExecutionError', message: 'gas est failed' };
    const out = decodeViemError(error);
    expect(out?.kind).toBe('gas.estimateFailed');
  });

  it('decodes InsufficientFundsError', () => {
    const error = {
      name: 'InsufficientFundsError',
      shortMessage: 'Insufficient funds for gas + value',
    };
    const out = decodeViemError(error);
    expect(out?.kind).toBe('tx.insufficientFunds');
  });

  it('captures unknown viem error name as kind=unknown but keeps name', () => {
    const error = {
      name: 'SomeNewViemError',
      shortMessage: 'a totally novel failure',
    };
    const out = decodeViemError(error);
    expect(out?.kind).toBe('unknown');
    expect(out?.data.errorName).toBe('SomeNewViemError');
  });
});
