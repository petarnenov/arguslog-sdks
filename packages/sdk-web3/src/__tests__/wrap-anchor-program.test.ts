import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'evt-1'),
}));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb, captureException }));

import { wrapAnchorProgram } from '../wrap-anchor-program.js';

describe('wrapAnchorProgram', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
    captureException.mockReset().mockReturnValue('evt-1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeProgram(rpcImpl: (...args: unknown[]) => Promise<unknown>) {
    return {
      programId: { toBase58: () => 'Prog11111111111111111111111111111111111111' },
      methods: {
        swap: vi.fn((..._args: unknown[]) => ({
          accounts: vi.fn().mockReturnThis(),
          signers: vi.fn().mockReturnThis(),
          rpc: rpcImpl,
        })),
      },
    };
  }

  it('wraps program.methods.X.builder.rpc() and records success', async () => {
    const program = makeProgram(async () => 'sig123abcdefghijklmnopqrstuvwxyz');
    const wrapped = wrapAnchorProgram(program);
    const sig = await wrapped.methods.swap(1n, 2n).accounts({ pool: 'P' }).rpc();
    expect(sig).toBe('sig123abcdefghijklmnopqrstuvwxyz');
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.tx',
        data: expect.objectContaining({
          contract: 'Prog11111111111111111111111111111111111111',
          functionName: 'swap',
        }),
      }),
    );
  });

  it('captures errors via captureWeb3Error and re-throws', async () => {
    const error = new Error(
      'AnchorError occurred. Error Code: SlippageExceeded. Error Number: 6001. Error Message: Slippage tolerance exceeded.',
    );
    const program = makeProgram(async () => {
      throw error;
    });
    const wrapped = wrapAnchorProgram(program);
    await expect(wrapped.methods.swap(1n).rpc()).rejects.toBe(error);
    expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ category: 'web3.error' }));
  });

  it('treats .simulate() as a simulate breadcrumb', async () => {
    const program = {
      programId: { toBase58: () => 'Prog' },
      methods: {
        ping: vi.fn(() => ({ simulate: async () => ({ value: { logs: ['ok'] } }) })),
      },
    };
    const wrapped = wrapAnchorProgram(program);
    await wrapped.methods.ping().simulate();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'web3.simulate' }),
    );
  });
});
