import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'evt-1'),
}));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb, captureException }));

import { wrapSolanaConnection } from '../wrap-solana-connection.js';

describe('wrapSolanaConnection', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
    captureException.mockReset().mockReturnValue('evt-1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through successful sendTransaction calls untouched', async () => {
    const conn = {
      sendTransaction: vi.fn(async (_tx: unknown) => 'sigOK'),
    };
    const wrapped = wrapSolanaConnection(conn);
    const out = await wrapped.sendTransaction({ instructions: [] });
    expect(out).toBe('sigOK');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('captures sendTransaction errors with chain + wallet stamps and re-throws', async () => {
    const error = {
      name: 'SendTransactionError',
      logs: [
        'Program ABC invoke [1]',
        'Program log: AnchorError caused by account: pool. Error Code: SlippageExceeded. Error Number: 6010. Error Message: Slippage tolerance exceeded.',
      ],
      signature: 'sig123',
    };
    const conn = {
      sendTransaction: vi.fn(async (_tx: unknown) => {
        throw error;
      }),
    };
    const wrapped = wrapSolanaConnection(conn, {
      wallet: 'phantom',
      chain: { id: 'mainnet-beta', name: 'Solana mainnet' },
    });
    await expect(wrapped.sendTransaction({})).rejects.toBe(error);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          wallet: 'phantom',
          chain: { id: 'mainnet-beta', name: 'Solana mainnet' },
          functionName: 'sendTransaction',
          errorCode: 'SlippageExceeded',
        }),
      }),
    );
  });

  it('captures simulateTransaction errors', async () => {
    const conn = {
      simulateTransaction: vi.fn(async (_tx: unknown) => {
        throw new Error('Simulation failed: AccountNotFound');
      }),
    };
    const wrapped = wrapSolanaConnection(conn);
    await expect(wrapped.simulateTransaction({})).rejects.toThrow();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ functionName: 'simulateTransaction' }),
      }),
    );
  });

  it('captures confirmTransaction errors (blockhash expired)', async () => {
    const conn = {
      confirmTransaction: vi.fn(async (_strategy: unknown) => {
        throw {
          name: 'TransactionExpiredBlockheightExceededError',
          message: 'block height exceeded',
        };
      }),
    };
    const wrapped = wrapSolanaConnection(conn);
    await expect(wrapped.confirmTransaction({})).rejects.toBeDefined();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'solana.blockhashExpired' }),
      }),
    );
  });

  it('records a web3.tx success breadcrumb on sendTransaction', async () => {
    const conn = {
      sendTransaction: vi.fn(async (_tx: unknown) => 'sigOK1234567890ABCDEFGHIJKLMNO'),
    };
    const wrapped = wrapSolanaConnection(conn, {
      chain: { id: 'mainnet-beta' },
      wallet: 'phantom',
    });
    await wrapped.sendTransaction({});
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.tx',
        data: expect.objectContaining({
          functionName: 'sendTransaction',
          result: 'sigOK1234567890ABCDEFGHIJKLMNO',
        }),
      }),
    );
  });

  it('records a web3.simulate success breadcrumb on simulateTransaction', async () => {
    const conn = {
      simulateTransaction: vi.fn(async (_tx: unknown) => ({ value: { logs: ['ok'] } })),
    };
    const wrapped = wrapSolanaConnection(conn);
    await wrapped.simulateTransaction({});
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'web3.simulate' }),
    );
  });

  it('records a web3.confirm success breadcrumb on confirmTransaction', async () => {
    const conn = {
      confirmTransaction: vi.fn(async (_strategy: unknown) => ({ value: { err: null } })),
    };
    const wrapped = wrapSolanaConnection(conn);
    await wrapped.confirmTransaction({});
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'web3.confirm' }),
    );
  });

  it('skips success breadcrumbs when recordSuccess: false', async () => {
    const conn = {
      sendTransaction: vi.fn(async (_tx: unknown) => 'sig'),
    };
    const wrapped = wrapSolanaConnection(conn, { recordSuccess: false });
    await wrapped.sendTransaction({});
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('does NOT wrap untracked methods (read calls)', async () => {
    const getBalance = vi.fn(async (_pk: unknown) => {
      throw new Error('rpc fail');
    });
    const conn = { getBalance };
    const wrapped = wrapSolanaConnection(conn);
    await expect(wrapped.getBalance('pk')).rejects.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });
});
