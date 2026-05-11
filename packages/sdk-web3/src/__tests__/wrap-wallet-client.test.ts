import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'evt-1'),
}));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb, captureException }));

import { wrapWalletClient } from '../wrap-wallet-client.js';

describe('wrapWalletClient', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
    captureException.mockReset().mockReturnValue('evt-1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through successful writeContract calls untouched', async () => {
    const client = {
      writeContract: vi.fn(async (_opts: unknown) => '0xtxhash'),
    };
    const wrapped = wrapWalletClient(client);
    const out = await wrapped.writeContract({
      address: '0xA',
      functionName: 'transfer',
      args: [1n],
    });
    expect(out).toBe('0xtxhash');
    expect(captureException).not.toHaveBeenCalled();
    expect(client.writeContract).toHaveBeenCalledOnce();
  });

  it('records a web3.tx success breadcrumb on writeContract', async () => {
    const client = {
      writeContract: vi.fn(async (_opts: unknown) => '0xtxhash1234567890abcd'),
    };
    const wrapped = wrapWalletClient(client, { chain: { id: 1 }, wallet: 'metamask' });
    await wrapped.writeContract({ address: '0xCAFE', functionName: 'mint', args: [1n] });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.tx',
        level: 'info',
        data: expect.objectContaining({
          contract: '0xCAFE',
          functionName: 'mint',
          result: '0xtxhash1234567890abcd',
        }),
      }),
    );
  });

  it('records a web3.sign success breadcrumb on signMessage', async () => {
    const client = {
      signMessage: vi.fn(async (_opts: unknown) => '0xsig...'),
    };
    const wrapped = wrapWalletClient(client);
    await wrapped.signMessage({ message: 'hello' });
    expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ category: 'web3.sign' }));
  });

  it('skips success breadcrumb when recordSuccess is false', async () => {
    const client = {
      writeContract: vi.fn(async (_opts: unknown) => '0xtxhash'),
    };
    const wrapped = wrapWalletClient(client, { recordSuccess: false });
    await wrapped.writeContract({ address: '0xA', functionName: 'mint' });
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('captures errors thrown by writeContract with rich context and re-throws', async () => {
    const error = {
      name: 'ContractFunctionRevertedError',
      data: { errorName: 'Slippage', args: [] },
    };
    const client = {
      writeContract: vi.fn(async (_opts: unknown) => {
        throw error;
      }),
    };
    const wrapped = wrapWalletClient(client, {
      wallet: 'metamask',
      chain: { id: 1, name: 'Ethereum mainnet' },
    });
    await expect(
      wrapped.writeContract({
        address: '0xA0b8',
        functionName: 'transfer',
        args: ['0xRecipient', 100n],
      }),
    ).rejects.toBe(error);

    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.error',
        data: expect.objectContaining({
          contract: '0xA0b8',
          functionName: 'transfer',
          chain: { id: 1, name: 'Ethereum mainnet' },
          wallet: 'metamask',
        }),
      }),
    );
  });

  it('captures sendTransaction errors with `to` as contract address', async () => {
    const client = {
      sendTransaction: vi.fn(async (_opts: unknown) => {
        throw new Error('boom');
      }),
    };
    const wrapped = wrapWalletClient(client);
    await expect(wrapped.sendTransaction({ to: '0xRecipient', value: 1n })).rejects.toThrow();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contract: '0xRecipient' }),
      }),
    );
  });

  it('does NOT wrap untracked methods (e.g. read calls)', async () => {
    const getBalance = vi.fn(async (_opts: unknown) => {
      throw new Error('rpc fail');
    });
    const client = { getBalance };
    const wrapped = wrapWalletClient(client);
    await expect(wrapped.getBalance({ address: '0xA' })).rejects.toThrow();
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('enrichContext hook merges into the captured context', async () => {
    const client = {
      writeContract: vi.fn(async (_opts: unknown) => {
        throw new Error('boom');
      }),
    };
    const wrapped = wrapWalletClient(client, {
      enrichContext: () => ({ extra: { traceId: 'abc-123' } }),
    });
    await expect(wrapped.writeContract({ address: '0xA' })).rejects.toThrow();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ traceId: 'abc-123' }),
      }),
    );
  });
});
