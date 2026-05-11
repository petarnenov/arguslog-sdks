import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'evt-1'),
}));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb, captureException }));

import { wrapEthersContract } from '../wrap-ethers-contract.js';

describe('wrapEthersContract', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
    captureException.mockReset().mockReturnValue('evt-1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures errors thrown by a contract method and re-throws', async () => {
    const contract = {
      target: '0xCAFE',
      transfer: vi.fn(async (..._args: unknown[]) => {
        const e: { code?: string; message: string } = {
          code: 'ACTION_REJECTED',
          message: 'user rejected',
        };
        throw e;
      }),
    };
    const wrapped = wrapEthersContract(contract, { chain: { id: 1, name: 'mainnet' } });
    await expect(wrapped.transfer('0xR', 100n)).rejects.toMatchObject({ code: 'ACTION_REJECTED' });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.error',
        data: expect.objectContaining({
          contract: '0xCAFE',
          functionName: 'transfer',
        }),
      }),
    );
  });

  it('emits a success breadcrumb with the tx hash for a state-mutating call', async () => {
    const contract = {
      target: '0xCAFE',
      mint: vi.fn(async (..._args: unknown[]) => ({
        hash: '0xtxhash1234567890',
        wait: async () => undefined,
      })),
    };
    const wrapped = wrapEthersContract(contract);
    const result = await wrapped.mint(1n);
    expect((result as { hash: string }).hash).toBe('0xtxhash1234567890');
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.tx',
        data: expect.objectContaining({
          contract: '0xCAFE',
          functionName: 'mint',
        }),
      }),
    );
  });

  it('does not breadcrumb default-skipped read methods', async () => {
    const contract = {
      target: '0xCAFE',
      balanceOf: vi.fn(async (..._args: unknown[]) => 1000n),
      decimals: vi.fn(async (..._args: unknown[]) => 18),
    };
    const wrapped = wrapEthersContract(contract);
    await wrapped.balanceOf('0xA');
    await wrapped.decimals();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('falls back to .address (ethers v5) when .target is missing', async () => {
    const contract = {
      address: '0xLEGACY',
      poke: vi.fn(async (..._args: unknown[]) => {
        throw new Error('boom');
      }),
    };
    const wrapped = wrapEthersContract(contract);
    await expect(wrapped.poke()).rejects.toThrow();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contract: '0xLEGACY' }),
      }),
    );
  });
});
