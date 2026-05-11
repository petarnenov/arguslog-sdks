import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'evt-1'),
}));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb, captureException }));

import {
  installWagmiReporter,
  type MutationCacheLike,
  type MutationCacheNotifyEvent,
  type QueryClientLike,
} from '../wagmi-reporter.js';

function fakeQueryClient(): {
  client: QueryClientLike;
  emit: (event: MutationCacheNotifyEvent) => void;
  listenerCount: () => number;
} {
  const listeners: Array<(e: MutationCacheNotifyEvent) => void> = [];
  const cache: MutationCacheLike = {
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  return {
    client: { getMutationCache: () => cache },
    emit: (e) => listeners.slice().forEach((cb) => cb(e)),
    listenerCount: () => listeners.length,
  };
}

describe('installWagmiReporter', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
    captureException.mockReset().mockReturnValue('evt-1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures wagmi writeContract errors with extracted contract + function + args', () => {
    const { client, emit } = fakeQueryClient();
    const off = installWagmiReporter(client, { wallet: 'metamask' });

    emit({
      type: 'updated',
      mutation: {
        state: {
          status: 'error',
          error: { name: 'ContractFunctionRevertedError', data: { errorName: 'Slippage' } },
          variables: { address: '0xA0b8', functionName: 'transfer', args: ['0xRecipient', 100n] },
        },
        options: { mutationKey: ['writeContract'] },
      },
    });

    expect(captureException).toHaveBeenCalledOnce();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contract: '0xA0b8',
          functionName: 'transfer',
          wallet: 'metamask',
        }),
      }),
    );
    off();
  });

  it('captures sendTransaction errors with `to` as contract', () => {
    const { client, emit } = fakeQueryClient();
    installWagmiReporter(client);
    emit({
      type: 'updated',
      mutation: {
        state: {
          status: 'error',
          error: new Error('send failed'),
          variables: { to: '0xRecipient', value: 1n },
        },
        options: { mutationKey: ['sendTransaction'] },
      },
    });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contract: '0xRecipient', functionName: 'sendTransaction' }),
      }),
    );
  });

  it('packs the chainId from switchChain variables onto the chain context', () => {
    const { client, emit } = fakeQueryClient();
    installWagmiReporter(client);
    emit({
      type: 'updated',
      mutation: {
        state: {
          status: 'error',
          error: { name: 'UserRejectedRequestError', shortMessage: 'rejected' },
          variables: { chainId: 8453 },
        },
        options: { mutationKey: ['switchChain'] },
      },
    });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          functionName: 'switchChain',
          chain: { id: 8453 },
        }),
      }),
    );
  });

  it('ignores untracked mutation keys (queries, custom user mutations)', () => {
    const { client, emit } = fakeQueryClient();
    installWagmiReporter(client);
    emit({
      type: 'updated',
      mutation: {
        state: { status: 'error', error: new Error('whatever') },
        options: { mutationKey: ['someUserMutation'] },
      },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('records a success breadcrumb on writeContract success and never calls captureException', () => {
    const { client, emit } = fakeQueryClient();
    installWagmiReporter(client);
    emit({
      type: 'updated',
      mutation: {
        state: {
          status: 'success',
          variables: { address: '0xCAFE', functionName: 'mint', args: [1n] },
          data: '0xtxhash1234567890',
        },
        options: { mutationKey: ['writeContract'] },
      },
    });
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.tx',
        data: expect.objectContaining({
          contract: '0xCAFE',
          functionName: 'mint',
          result: '0xtxhash1234567890',
        }),
      }),
    );
  });

  it('records a web3.switch breadcrumb on switchChain success', () => {
    const { client, emit } = fakeQueryClient();
    installWagmiReporter(client);
    emit({
      type: 'updated',
      mutation: {
        state: { status: 'success', variables: { chainId: 8453 } },
        options: { mutationKey: ['switchChain'] },
      },
    });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'web3.switch' }),
    );
  });

  it('skips success breadcrumb when recordSuccess is false', () => {
    const { client, emit } = fakeQueryClient();
    installWagmiReporter(client, { recordSuccess: false });
    emit({
      type: 'updated',
      mutation: {
        state: { status: 'success', variables: { address: '0xA' }, data: '0xtxhash' },
        options: { mutationKey: ['writeContract'] },
      },
    });
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('ignores pending state transitions', () => {
    const { client, emit } = fakeQueryClient();
    installWagmiReporter(client);
    emit({
      type: 'updated',
      mutation: {
        state: { status: 'pending' },
        options: { mutationKey: ['writeContract'] },
      },
    });
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('uninstall removes the subscription', () => {
    const { client, emit, listenerCount } = fakeQueryClient();
    const off = installWagmiReporter(client);
    expect(listenerCount()).toBe(1);
    off();
    expect(listenerCount()).toBe(0);
    emit({
      type: 'updated',
      mutation: {
        state: { status: 'error', error: new Error('x') },
        options: { mutationKey: ['writeContract'] },
      },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('enrichContext hook merges into the captured context', () => {
    const { client, emit } = fakeQueryClient();
    installWagmiReporter(client, {
      enrichContext: () => ({ extra: { traceId: 'trace-7' } }),
    });
    emit({
      type: 'updated',
      mutation: {
        state: { status: 'error', error: new Error('boom'), variables: { address: '0xA' } },
        options: { mutationKey: ['writeContract'] },
      },
    });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ traceId: 'trace-7' }),
      }),
    );
  });
});
