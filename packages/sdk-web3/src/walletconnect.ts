import { addBreadcrumb } from '@arguslog/sdk-browser';

import type { Eip1193Provider } from './eip-1193.js';

/**
 * WalletConnect v2 providers extend the EIP-1193 surface with additional session-lifecycle
 * events that {@link installProviderBreadcrumbs} doesn't know about. This integration
 * layers those on top — call it AFTER {@code installProviderBreadcrumbs} for the same
 * provider so the consumer gets both standard EIP-1193 breadcrumbs (chainChanged,
 * accountsChanged, connect, disconnect) AND WC-specific ones (display_uri, session_event,
 * session_update, session_delete, session_expire).
 *
 * <p>Why it matters: a WC session quietly expiring 30s before a failed sign attempt is a
 * common cause of "the wallet didn't respond" tickets. With this listener, the dashboard
 * sees the {@code session_delete} breadcrumb right above the error.
 */
const WC_EVENTS = [
  'display_uri',
  'session_event',
  'session_update',
  'session_delete',
  'session_expire',
  'session_request',
  'session_request_expire',
  'session_authenticate',
] as const;

export function installWalletConnectBreadcrumbs(
  provider: Eip1193Provider | null | undefined,
): () => void {
  if (!provider || typeof provider.on !== 'function') return () => {};

  const handlers: Array<{ event: string; listener: (...args: unknown[]) => void }> = [];

  for (const event of WC_EVENTS) {
    const listener = (...args: unknown[]) => {
      try {
        addBreadcrumb({
          category: 'web3.walletconnect',
          message: event,
          level: event === 'session_delete' || event === 'session_expire' ? 'warning' : 'info',
          data: { event, payload: summarisePayload(args[0]) },
        });
      } catch {
        // best-effort
      }
    };
    provider.on(event, listener);
    handlers.push({ event, listener });
  }

  return () => {
    for (const { event, listener } of handlers) {
      try {
        provider.removeListener(event, listener);
      } catch {
        // best-effort — some WC providers throw when unsubscribing from a non-existent event
      }
    }
  };
}

function summarisePayload(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') return undefined;

  // WC payloads can be deep + carry full session metadata (peer info, namespaces, accounts).
  // Strip down to the few fields that matter for debugging — full payload would bloat the
  // breadcrumb buffer.
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if ('topic' in obj) out.topic = obj.topic;
  if ('id' in obj) out.id = obj.id;
  if ('uri' in obj) out.uri = typeof obj.uri === 'string' ? `${obj.uri.slice(0, 40)}…` : undefined;
  if ('chainId' in obj) out.chainId = obj.chainId;
  if ('event' in obj && typeof obj.event === 'object' && obj.event !== null) {
    out.event = (obj.event as Record<string, unknown>).name ?? obj.event;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
