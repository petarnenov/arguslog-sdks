import { addBreadcrumb } from '@arguslog/sdk-browser';

import type { WalletKind } from './types.js';

/**
 * Listens to {@code @solana/wallet-adapter-base} adapter events and records them as
 * breadcrumbs. Counterpart to the EVM-side {@link installProviderBreadcrumbs} — Solana
 * wallets don't speak EIP-1193, they expose a small {@code on / off} event surface plus
 * {@code publicKey} / {@code connected} / {@code connecting} state fields.
 *
 * <p>Tracked events:
 *
 * <ul>
 *   <li>{@code connect} — the wallet became connected; we record the (truncated) public
 *       key + the adapter's {@code name}.</li>
 *   <li>{@code disconnect} — connection lost / user clicked disconnect.</li>
 *   <li>{@code error} — adapter-level error event (separate from per-call rejection).</li>
 *   <li>{@code readyStateChange} — useful for "wallet not installed" / "user just opened
 *       it" transitions during onboarding flows.</li>
 * </ul>
 */
export interface SolanaWalletAdapter {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  publicKey?: { toBase58(): string } | null;
  /** Adapter name — e.g. {@code 'Phantom'}, {@code 'Solflare'}, {@code 'Backpack'}. */
  name?: string;
  connected?: boolean;
  connecting?: boolean;
  readyState?: string;
}

export function installSolanaWalletBreadcrumbs(
  adapter: SolanaWalletAdapter | null | undefined,
): () => void {
  if (!adapter || typeof adapter.on !== 'function') return () => {};

  const wallet = nameToKind(adapter.name);

  const onConnect = () => {
    safeBreadcrumb({
      category: 'web3.wallet',
      level: 'info',
      message: `connected ${adapter.name ?? 'wallet'}`,
      data: {
        wallet,
        adapter: adapter.name,
        publicKey: truncatePubkey(adapter.publicKey?.toBase58?.()),
      },
    });
  };

  const onDisconnect = () => {
    safeBreadcrumb({
      category: 'web3.wallet',
      level: 'warning',
      message: 'wallet disconnected',
      data: { wallet, adapter: adapter.name },
    });
  };

  const onError = (...args: unknown[]) => {
    const err = args[0];
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'wallet adapter error';
    safeBreadcrumb({
      category: 'web3.wallet',
      level: 'error',
      message: `wallet error: ${message}`,
      data: { wallet, adapter: adapter.name, error: message },
    });
  };

  const onReadyStateChange = (...args: unknown[]) => {
    const next = args[0] as string;
    safeBreadcrumb({
      category: 'web3.wallet',
      level: 'info',
      message: `readyStateChange → ${next}`,
      data: { wallet, adapter: adapter.name, readyState: next },
    });
  };

  adapter.on('connect', onConnect);
  adapter.on('disconnect', onDisconnect);
  adapter.on('error', onError);
  adapter.on('readyStateChange', onReadyStateChange);

  return () => {
    adapter.off('connect', onConnect);
    adapter.off('disconnect', onDisconnect);
    adapter.off('error', onError);
    adapter.off('readyStateChange', onReadyStateChange);
  };
}

function nameToKind(name: string | undefined): WalletKind {
  if (!name) return 'unknown';
  const lc = name.toLowerCase();
  if (lc.includes('phantom')) return 'phantom';
  if (lc.includes('solflare')) return 'solflare';
  if (lc.includes('backpack')) return 'backpack';
  if (lc.includes('glow')) return 'glow';
  return 'unknown';
}

function truncatePubkey(pk: string | undefined): string | undefined {
  if (!pk) return undefined;
  return pk.length > 10 ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : pk;
}

function safeBreadcrumb(crumb: {
  category: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  data?: Record<string, unknown>;
}) {
  try {
    addBreadcrumb(crumb);
  } catch {
    // best-effort
  }
}
