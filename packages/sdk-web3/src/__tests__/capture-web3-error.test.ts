import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'evt-1'),
}));

vi.mock('@arguslog/sdk-browser', () => ({
  addBreadcrumb,
  captureException,
}));

import { captureWeb3Error } from '../capture-web3-error.js';

describe('captureWeb3Error', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
    captureException.mockReset().mockReturnValue('evt-1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes a viem ContractFunctionRevertedError into a rich breadcrumb + tagged event', () => {
    const error = {
      name: 'ContractFunctionRevertedError',
      data: { errorName: 'ERC20InsufficientBalance', args: ['0xUser', 50n, 100n] },
      reason: 'ERC20InsufficientBalance',
    };
    const id = captureWeb3Error(error, {
      chain: { id: 1, name: 'Ethereum mainnet' },
      wallet: 'metamask',
      contract: '0xA0b8',
      functionName: 'transfer',
      args: ['0xRecipient', 100n],
    });
    expect(id).toBe('evt-1');
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.error',
        level: 'error',
        message: expect.stringContaining('ERC20InsufficientBalance'),
        data: expect.objectContaining({
          kind: 'contract.reverted',
          source: 'viem',
          chain: { id: 1, name: 'Ethereum mainnet' },
          wallet: 'metamask',
          contract: '0xA0b8',
          functionName: 'transfer',
          errorName: 'ERC20InsufficientBalance',
        }),
      }),
    );
    expect(captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({
          'web3.kind': 'contract.reverted',
          'web3.source': 'viem',
          'web3.chain': 'Ethereum mainnet',
          'web3.wallet': 'metamask',
          'web3.contract': '0xA0b8',
        }),
      }),
    );
  });

  it('captures user-rejected as info level (not noisy alerts)', () => {
    captureWeb3Error({ name: 'UserRejectedRequestError', shortMessage: 'rejected' });
    expect(captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: 'info' }),
    );
  });

  it('falls back to ethers decoder when viem decoder finds nothing', () => {
    captureWeb3Error({ code: 'ACTION_REJECTED', shortMessage: 'rejected' });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'user.rejected', source: 'ethers' }),
      }),
    );
  });

  it('falls back to generic decoder for plain Errors', () => {
    captureWeb3Error(new Error('something went wrong'), { wallet: 'metamask' });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'unknown', source: 'unknown' }),
      }),
    );
    expect(captureException).toHaveBeenCalled();
  });

  it('chain.mismatch is warning, not error', () => {
    captureWeb3Error({ name: 'ChainMismatchError', shortMessage: 'wrong chain' });
    expect(captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: 'warning' }),
    );
  });
});
