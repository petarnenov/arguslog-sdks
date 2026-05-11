import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb } = vi.hoisted(() => ({ addBreadcrumb: vi.fn() }));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb }));

import {
  installSolanaWalletBreadcrumbs,
  type SolanaWalletAdapter,
} from '../solana-wallet-adapter.js';

function fakeAdapter(name = 'Phantom'): SolanaWalletAdapter & {
  emit: (event: string, ...args: unknown[]) => void;
  listeners: Record<string, Array<(...args: unknown[]) => void>>;
} {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    name,
    publicKey: { toBase58: () => 'BOLDpubKeySomething123abcdef' },
    listeners,
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
    },
    off(event, listener) {
      const arr = listeners[event];
      if (!arr) return;
      const i = arr.indexOf(listener);
      if (i >= 0) arr.splice(i, 1);
    },
    emit(event, ...args) {
      listeners[event]?.slice().forEach((cb) => cb(...args));
    },
  };
}

describe('installSolanaWalletBreadcrumbs', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
  });

  it('records breadcrumb on connect with truncated public key + adapter name', () => {
    const adapter = fakeAdapter('Phantom');
    const off = installSolanaWalletBreadcrumbs(adapter);
    adapter.emit('connect');
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.wallet',
        message: 'connected Phantom',
        data: expect.objectContaining({
          wallet: 'phantom',
          adapter: 'Phantom',
          publicKey: 'BOLD…cdef',
        }),
      }),
    );
    off();
  });

  it('detects solflare / backpack / glow adapters by name', () => {
    for (const name of ['Solflare', 'Backpack', 'Glow']) {
      addBreadcrumb.mockReset();
      const adapter = fakeAdapter(name);
      const off = installSolanaWalletBreadcrumbs(adapter);
      adapter.emit('connect');
      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ wallet: name.toLowerCase() }),
        }),
      );
      off();
    }
  });

  it('records disconnect at warning level', () => {
    const adapter = fakeAdapter();
    installSolanaWalletBreadcrumbs(adapter);
    adapter.emit('disconnect');
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning', message: 'wallet disconnected' }),
    );
  });

  it('records error event with the message', () => {
    const adapter = fakeAdapter();
    installSolanaWalletBreadcrumbs(adapter);
    adapter.emit('error', new Error('user closed popup'));
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('user closed popup'),
      }),
    );
  });

  it('records readyStateChange', () => {
    const adapter = fakeAdapter();
    installSolanaWalletBreadcrumbs(adapter);
    adapter.emit('readyStateChange', 'Installed');
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'readyStateChange → Installed',
        data: expect.objectContaining({ readyState: 'Installed' }),
      }),
    );
  });

  it('uninstall removes all listeners', () => {
    const adapter = fakeAdapter();
    const off = installSolanaWalletBreadcrumbs(adapter);
    off();
    adapter.emit('connect');
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('no-ops on null adapter', () => {
    const off = installSolanaWalletBreadcrumbs(null);
    off();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });
});
