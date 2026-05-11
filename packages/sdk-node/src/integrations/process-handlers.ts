import type { ArguslogClient } from '@arguslog/sdk-core';

export interface ProcessHandlerOptions {
  /**
   * Whether to call `process.exit(1)` after flushing on `uncaughtException`. Defaults to true,
   * matching Node's default crash-on-uncaught behavior — apps that disable this must replace it
   * with their own restart strategy or risk an event loop in an inconsistent state.
   */
  exitOnUncaught?: boolean;
  /** Maximum time to wait for the transport to drain before exit/continue. Default 2000ms. */
  flushTimeoutMs?: number;
}

/**
 * Wires `uncaughtException`, `unhandledRejection`, and `beforeExit` handlers that funnel into
 * the client. Returns an unbinder for tests/teardown.
 */
export function installProcessHandlers(
  client: ArguslogClient,
  opts: ProcessHandlerOptions = {},
): () => void {
  const exitOnUncaught = opts.exitOnUncaught ?? true;
  const flushTimeoutMs = opts.flushTimeoutMs ?? 2000;

  const onUncaught = (err: Error): void => {
    client.captureException(err, { level: 'fatal' });
    void raceFlush(client, flushTimeoutMs).finally(() => {
      if (exitOnUncaught) process.exit(1);
    });
  };

  const onUnhandled = (reason: unknown): void => {
    const err = reason instanceof Error ? reason : new Error(stringifyReason(reason));
    client.captureException(err, { level: 'error' });
  };

  const onBeforeExit = (): void => {
    void raceFlush(client, flushTimeoutMs);
  };

  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUnhandled);
  process.on('beforeExit', onBeforeExit);

  return () => {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUnhandled);
    process.off('beforeExit', onBeforeExit);
  };
}

function raceFlush(client: ArguslogClient, ms: number): Promise<void> {
  return Promise.race([
    client.flush(),
    new Promise<void>((resolve) => setTimeout(resolve, ms).unref()),
  ]);
}

function stringifyReason(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}
