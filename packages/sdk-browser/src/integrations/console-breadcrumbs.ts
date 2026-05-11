import type { ArguslogClient, Level } from '@arguslog/sdk-core';

/**
 * Wraps {@code console.log/info/warn/error/debug} so each call also lands as a breadcrumb on
 * the active client. The original console behaviour is preserved — args are forwarded to the
 * native method first, breadcrumb append happens in a try/catch so a misbehaving
 * {@code addBreadcrumb} can never blow up the user's logging.
 *
 * <p>Mapping: {@code debug → debug}, {@code log/info → info}, {@code warn → warning},
 * {@code error → error}. Args after the first are stringified into {@code data.extra} so a
 * call like {@code console.error('login failed', { userId: 4 })} surfaces both the message
 * and the structured payload on the event timeline.
 */
type ConsoleMethod = 'debug' | 'log' | 'info' | 'warn' | 'error';
const METHODS: ConsoleMethod[] = ['debug', 'log', 'info', 'warn', 'error'];
const METHOD_TO_LEVEL: Record<ConsoleMethod, Level> = {
  debug: 'debug',
  log: 'info',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

export function installConsoleBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof console === 'undefined') return () => {};

  const originals: Partial<Record<ConsoleMethod, typeof console.log>> = {};
  for (const method of METHODS) {
    const original = console[method] as typeof console.log;
    if (typeof original !== 'function') continue;
    originals[method] = original;
    (console as Console)[method] = ((...args: unknown[]) => {
      try {
        original.apply(console, args);
      } catch {
        // ignore — never let our wrapping break the host app's logging path
      }
      try {
        const message =
          typeof args[0] === 'string'
            ? args[0]
            : args[0] === undefined
              ? ''
              : safeStringify(args[0]);
        const data = args.length > 1 ? { extra: args.slice(1).map(safeStringify) } : undefined;
        client.addBreadcrumb({
          category: 'console',
          message: message || `console.${method}`,
          level: METHOD_TO_LEVEL[method],
          data,
        });
      } catch {
        // ignore — breadcrumb capture is best-effort
      }
    }) as typeof console.log;
  }

  return () => {
    for (const method of METHODS) {
      const original = originals[method];
      if (original) (console as Console)[method] = original;
    }
  };
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
