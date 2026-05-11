import { addBreadcrumb, type Level } from '@arguslog/sdk-browser';

import type { WalletKind } from './types.js';

/**
 * Listens to the EIP-1193 events the wallet provider emits during a session and records each
 * one as a breadcrumb. Lets the dashboard reconstruct "user switched chain mid-flow" /
 * "wallet got disconnected just before the failed tx" / "user changed accounts after signing
 * the typed data" — common root causes that look like generic errors otherwise.
 *
 * <p>Tracked events:
 *
 * <ul>
 *   <li>{@code accountsChanged} — array of accounts; empty means disconnected</li>
 *   <li>{@code chainChanged} — hex chain id; emitted when MetaMask / WalletConnect switches</li>
 *   <li>{@code connect} — provider connected to a chain</li>
 *   <li>{@code disconnect} — provider lost connection</li>
 *   <li>{@code message} — generic provider notification (rare)</li>
 * </ul>
 */
export interface Eip1193Provider {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
}

export function installProviderBreadcrumbs(
  provider: Eip1193Provider | undefined | null,
): () => void {
  if (!provider || typeof provider.on !== 'function') return () => {};

  const wallet = detectWallet(provider);

  const onAccountsChanged = (...args: unknown[]) => {
    const accounts = (args[0] as string[]) ?? [];
    safeBreadcrumb({
      category: 'web3.wallet',
      message:
        accounts.length === 0
          ? 'wallet disconnected'
          : `accountsChanged → ${truncateAddr(accounts[0])}`,
      level: accounts.length === 0 ? 'warning' : 'info',
      data: { wallet, accounts: accounts.map(truncateAddr), count: accounts.length },
    });
  };

  const onChainChanged = (...args: unknown[]) => {
    const chainIdHex = args[0] as string;
    const chainId = chainIdHex?.startsWith('0x') ? Number.parseInt(chainIdHex, 16) : undefined;
    safeBreadcrumb({
      category: 'web3.wallet',
      message: `chainChanged → ${chainId ?? chainIdHex}`,
      level: 'info',
      data: { wallet, chainId, chainIdHex },
    });
  };

  const onConnect = (...args: unknown[]) => {
    const info = (args[0] as { chainId?: string }) ?? {};
    const chainId = info.chainId?.startsWith('0x') ? Number.parseInt(info.chainId, 16) : undefined;
    safeBreadcrumb({
      category: 'web3.wallet',
      message: 'wallet connected',
      level: 'info',
      data: { wallet, chainId, chainIdHex: info.chainId },
    });
  };

  const onDisconnect = (...args: unknown[]) => {
    const error = args[0] as { code?: number; message?: string } | undefined;
    safeBreadcrumb({
      category: 'web3.wallet',
      message: 'wallet disconnected',
      level: 'warning',
      data: { wallet, code: error?.code, error: error?.message },
    });
  };

  provider.on('accountsChanged', onAccountsChanged);
  provider.on('chainChanged', onChainChanged);
  provider.on('connect', onConnect);
  provider.on('disconnect', onDisconnect);

  return () => {
    provider.removeListener('accountsChanged', onAccountsChanged);
    provider.removeListener('chainChanged', onChainChanged);
    provider.removeListener('connect', onConnect);
    provider.removeListener('disconnect', onDisconnect);
  };
}

export function detectWallet(provider: Eip1193Provider | undefined | null): WalletKind {
  if (!provider) return 'unknown';
  if (provider.isCoinbaseWallet) return 'coinbase';
  if (provider.isRabby) return 'rabby';
  if (provider.isTrust) return 'trust';
  if (provider.isMetaMask) return 'metamask';
  return 'unknown';
}

function safeBreadcrumb(crumb: {
  category: string;
  message: string;
  level: Level;
  data?: Record<string, unknown>;
}) {
  try {
    addBreadcrumb(crumb);
  } catch {
    // best-effort
  }
}

function truncateAddr(addr: string | undefined): string {
  if (!addr) return '';
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
