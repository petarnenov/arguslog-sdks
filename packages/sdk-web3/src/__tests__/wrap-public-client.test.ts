import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'evt-1'),
}));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb, captureException }));

import { wrapPublicClient } from '../wrap-public-client.js';

describe('wrapPublicClient', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
    captureException.mockReset().mockReturnValue('evt-1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through successful reads without breadcrumbing', async () => {
    const client = {
      readContract: vi.fn(async (_opts: unknown) => 1000n),
    };
    const wrapped = wrapPublicClient(client);
    const out = await wrapped.readContract({
      address: '0xA',
      functionName: 'balanceOf',
      args: ['0xB'],
    });
    expect(out).toBe(1000n);
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('captures readContract errors with contract + functionName', async () => {
    const client = {
      readContract: vi.fn(async (_opts: unknown) => {
        throw new Error('execution reverted');
      }),
    };
    const wrapped = wrapPublicClient(client, { chain: { id: 1 } });
    await expect(
      wrapped.readContract({ address: '0xCAFE', functionName: 'getPrice', args: [42n] }),
    ).rejects.toThrow();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.error',
        data: expect.objectContaining({
          contract: '0xCAFE',
          functionName: 'getPrice',
          chain: { id: 1 },
        }),
      }),
    );
  });

  it('captures simulateContract errors', async () => {
    const client = {
      simulateContract: vi.fn(async (_opts: unknown) => {
        throw new Error('simulation revert');
      }),
    };
    const wrapped = wrapPublicClient(client);
    await expect(
      wrapped.simulateContract({ address: '0xD', functionName: 'mint', args: [1n] }),
    ).rejects.toThrow();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ functionName: 'mint' }),
      }),
    );
  });

  it('does not wrap untracked methods', async () => {
    const getBlock = vi.fn(async (..._args: unknown[]) => {
      throw new Error('rpc failure');
    });
    const client = { getBlock };
    const wrapped = wrapPublicClient(client);
    await expect(wrapped.getBlock()).rejects.toThrow();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('captures waitForTransactionReceipt timeouts', async () => {
    const client = {
      waitForTransactionReceipt: vi.fn(async (..._args: unknown[]) => {
        throw new Error('Timed out');
      }),
    };
    const wrapped = wrapPublicClient(client);
    await expect(wrapped.waitForTransactionReceipt({ hash: '0xtx' })).rejects.toThrow();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ functionName: 'waitForTransactionReceipt' }),
      }),
    );
  });
});
