import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted to the top of the file by vitest's transform, so referencing a
// plain `const` would dereference an uninitialised binding. vi.hoisted gives the same
// hoist guarantee while letting the test file keep its imports under it.
const { addBreadcrumb } = vi.hoisted(() => ({ addBreadcrumb: vi.fn() }));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb }));

import { detectWallet, installProviderBreadcrumbs, type Eip1193Provider } from '../eip-1193.js';

function fakeProvider(flags: Partial<Eip1193Provider> = {}): Eip1193Provider & {
  emit: (event: string, ...args: unknown[]) => void;
} {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    isMetaMask: false,
    isCoinbaseWallet: false,
    isRabby: false,
    isTrust: false,
    ...flags,
    on(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(cb);
    },
    removeListener(event: string, cb: (...args: unknown[]) => void) {
      const arr = listeners[event];
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    },
    emit(event: string, ...args: unknown[]) {
      listeners[event]?.forEach((cb) => cb(...args));
    },
  };
}

describe('installProviderBreadcrumbs', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
  });

  it('records breadcrumb on accountsChanged', () => {
    const p = fakeProvider({ isMetaMask: true });
    const off = installProviderBreadcrumbs(p);
    p.emit('accountsChanged', ['0xabcdef0123456789abcdef0123456789abcdef01']);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.wallet',
        message: expect.stringMatching(/accountsChanged/),
        data: expect.objectContaining({ wallet: 'metamask', count: 1 }),
      }),
    );
    off();
  });

  it('emits warning when accounts go empty (disconnected)', () => {
    const p = fakeProvider({ isMetaMask: true });
    const off = installProviderBreadcrumbs(p);
    p.emit('accountsChanged', []);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: 'wallet disconnected',
      }),
    );
    off();
  });

  it('parses chainChanged hex to decimal chainId', () => {
    const p = fakeProvider({ isCoinbaseWallet: true });
    const off = installProviderBreadcrumbs(p);
    p.emit('chainChanged', '0x2105'); // 8453, Base mainnet
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ wallet: 'coinbase', chainId: 8453 }),
      }),
    );
    off();
  });

  it('records connect / disconnect events', () => {
    const p = fakeProvider();
    const off = installProviderBreadcrumbs(p);
    p.emit('connect', { chainId: '0x1' });
    p.emit('disconnect', { code: 4900, message: 'Disconnected' });
    expect(addBreadcrumb).toHaveBeenCalledTimes(2);
    expect(addBreadcrumb.mock.calls[0]![0]).toMatchObject({ message: 'wallet connected' });
    expect(addBreadcrumb.mock.calls[1]![0]).toMatchObject({
      message: 'wallet disconnected',
      level: 'warning',
    });
    off();
  });

  it('uninstall removes all listeners', () => {
    const p = fakeProvider({ isMetaMask: true });
    const off = installProviderBreadcrumbs(p);
    off();
    p.emit('accountsChanged', ['0x1']);
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('no-ops on null provider', () => {
    const off = installProviderBreadcrumbs(null);
    off();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });
});

describe('detectWallet', () => {
  it('returns metamask when isMetaMask flag is set', () => {
    expect(detectWallet({ isMetaMask: true } as Eip1193Provider)).toBe('metamask');
  });
  it('returns coinbase before metamask if both flags present (Coinbase Wallet sets isMetaMask too)', () => {
    expect(detectWallet({ isMetaMask: true, isCoinbaseWallet: true } as Eip1193Provider)).toBe(
      'coinbase',
    );
  });
  it('returns rabby / trust by their flags', () => {
    expect(detectWallet({ isRabby: true } as Eip1193Provider)).toBe('rabby');
    expect(detectWallet({ isTrust: true } as Eip1193Provider)).toBe('trust');
  });
  it('returns unknown for null / unrecognised provider', () => {
    expect(detectWallet(null)).toBe('unknown');
    expect(detectWallet({} as Eip1193Provider)).toBe('unknown');
  });
});
