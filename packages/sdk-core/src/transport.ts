import type { EventPayload, ParsedDsn } from './types.js';

export interface TransportOptions {
  fetch?: typeof fetch;
  maxRetries?: number;
  baseDelayMs?: number;
}

export class Transport {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly queue: EventPayload[] = [];
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly dsn: ParsedDsn,
    private readonly publicKey: string,
    opts: TransportOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 200;
  }

  enqueue(event: EventPayload): void {
    this.queue.push(event);
    void this.flush();
  }

  /**
   * Drains the queue. Concurrent callers receive the same in-flight promise so an
   * `await transport.flush()` always resolves *after* every queued event has been sent —
   * including events enqueued by `enqueue()`'s fire-and-forget flush call.
   */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      await this.send(event);
    }
  }

  private async send(event: EventPayload, attempt = 0): Promise<void> {
    try {
      const response = await this.fetchImpl(this.dsn.ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Arguslog-Auth': `Arguslog DSN ${this.publicKey}`,
        },
        body: JSON.stringify(event),
        keepalive: true,
      });
      if (response.status === 429 || response.status >= 500) {
        throw new RetriableError(`HTTP ${response.status}`);
      }
    } catch (err) {
      if (err instanceof RetriableError && attempt < this.maxRetries) {
        const delay = this.baseDelayMs * 2 ** attempt;
        await sleep(delay);
        return this.send(event, attempt + 1);
      }
      // swallow — never let SDK errors crash host app
    }
  }
}

class RetriableError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
