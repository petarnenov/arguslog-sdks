import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb } = vi.hoisted(() => ({ addBreadcrumb: vi.fn() }));
vi.mock('@arguslog/sdk-browser', () => ({ addBreadcrumb }));

import { type Eip1193Provider } from '../eip-1193.js';
import { installWalletConnectBreadcrumbs } from '../walletconnect.js';

function fakeProvider(): Eip1193Provider & {
  emit: (event: string, ...args: unknown[]) => void;
} {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
    },
    removeListener(event, listener) {
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

describe('installWalletConnectBreadcrumbs', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
  });

  it('records display_uri at info level', () => {
    const p = fakeProvider();
    const off = installWalletConnectBreadcrumbs(p);
    p.emit('display_uri', 'wc:01234567...');
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3.walletconnect',
        level: 'info',
        message: 'display_uri',
      }),
    );
    off();
  });

  it('records session_delete at warning level', () => {
    const p = fakeProvider();
    installWalletConnectBreadcrumbs(p);
    p.emit('session_delete', { topic: 'abc-topic-123', id: 7 });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'session_delete',
        level: 'warning',
        data: expect.objectContaining({
          payload: expect.objectContaining({ topic: 'abc-topic-123', id: 7 }),
        }),
      }),
    );
  });

  it('records session_expire at warning level', () => {
    const p = fakeProvider();
    installWalletConnectBreadcrumbs(p);
    p.emit('session_expire', { topic: 't' });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning', message: 'session_expire' }),
    );
  });

  it('summarises chainId out of session_event payloads', () => {
    const p = fakeProvider();
    installWalletConnectBreadcrumbs(p);
    p.emit('session_event', {
      topic: 't',
      chainId: 'eip155:1',
      event: { name: 'accountsChanged', data: ['0x...'] },
    });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            chainId: 'eip155:1',
            event: 'accountsChanged',
          }),
        }),
      }),
    );
  });

  it('truncates long URI strings', () => {
    const p = fakeProvider();
    installWalletConnectBreadcrumbs(p);
    p.emit('display_uri', { uri: 'wc:'.padEnd(200, 'x') });
    const call = addBreadcrumb.mock.calls[0]![0] as {
      data: { payload?: { uri?: string } };
    };
    expect(call.data.payload?.uri).toMatch(/…$/);
  });

  it('uninstall removes every listener', () => {
    const p = fakeProvider();
    const off = installWalletConnectBreadcrumbs(p);
    off();
    p.emit('session_delete', {});
    p.emit('display_uri', 'wc:x');
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('no-ops on null provider', () => {
    const off = installWalletConnectBreadcrumbs(null);
    off();
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });
});
