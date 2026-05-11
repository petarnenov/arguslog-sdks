import { parseDsn } from './dsn.js';
import { GlobalScope, type ScopeStore } from './scope.js';
import { Scrubber } from './scrubber.js';
import { Transport } from './transport.js';
import type {
  ArguslogOptions,
  Breadcrumb,
  EventPayload,
  Level,
  ParsedDsn,
  PlatformAdapter,
  StackParser,
  User,
} from './types.js';
// Re-exported from a generator-fed file so the runtime sdk.version stamped on every event
// tracks package.json:version. scripts/gen-version.mjs rewrites version.generated.ts before
// every build/test (prebuild + pretest hooks). Bumping the package version is a one-line
// change in package.json — no source edit needed.
import { SDK_VERSION } from './version.generated.js';
export { SDK_VERSION };

export interface ClientDeps {
  adapter: PlatformAdapter;
  parseStack: StackParser;
  /** Optional scope store. Defaults to a single GlobalScope shared across the client. */
  scopeStore?: ScopeStore;
}

export class ArguslogClient {
  private readonly options: ArguslogOptions;
  private readonly dsn: ParsedDsn;
  private readonly transport: Transport;
  private readonly scrubber: Scrubber;
  private readonly adapter: PlatformAdapter;
  private readonly parseStack: StackParser;
  private readonly scopeStore: ScopeStore;

  private pending: Set<Promise<void>> = new Set();

  constructor(options: ArguslogOptions, deps: ClientDeps) {
    this.options = options;
    this.adapter = deps.adapter;
    this.parseStack = deps.parseStack;
    this.dsn = parseDsn(options.dsn);
    this.scrubber = new Scrubber(options.scrubbing);
    this.scopeStore = deps.scopeStore ?? new GlobalScope(options.maxBreadcrumbs ?? 50);
    this.transport = new Transport(this.dsn, this.dsn.publicKey, {
      fetch: options.transport?.fetch,
      maxRetries: options.transport?.maxRetries,
    });
  }

  /** Exposed for SDK adapters that need to coordinate scope (e.g. per-request middleware). */
  getScopeStore(): ScopeStore {
    return this.scopeStore;
  }

  captureException(
    error: unknown,
    hint?: { level?: Level; tags?: Record<string, string> },
  ): string {
    const err = toError(error);
    const event = this.baseEvent(hint?.level ?? 'error');
    event.exception = {
      values: [
        {
          type: err.name || 'Error',
          value: err.message,
          stacktrace: { frames: this.parseStack(err.stack) },
        },
      ],
    };
    if (hint?.tags) {
      event.tags = { ...(event.tags ?? {}), ...hint.tags };
    }
    return this.dispatch(event);
  }

  captureMessage(message: string, level: Level = 'info'): string {
    const event = this.baseEvent(level);
    event.message = message;
    return this.dispatch(event);
  }

  addBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void {
    this.scopeStore.getBreadcrumbs().add({
      timestamp: crumb.timestamp ?? Date.now(),
      category: crumb.category,
      message: crumb.message,
      level: crumb.level,
      data: crumb.data,
    });
  }

  setUser(user: User | undefined): void {
    this.scopeStore.setUser(user);
  }

  setTag(key: string, value: string): void {
    this.scopeStore.setTag(key, value);
  }

  setContext(name: string, ctx: Record<string, unknown>): void {
    this.scopeStore.setContext(name, ctx);
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      const chains = Array.from(this.pending);
      this.pending.clear();
      await Promise.all(chains);
    }
    return this.transport.flush();
  }

  private baseEvent(level: Level): EventPayload {
    const user = this.scopeStore.getUser();
    const tags = this.scopeStore.getTags();
    const contexts = this.scopeStore.getContexts();
    const event: EventPayload = {
      eventId: cryptoRandomId(),
      timestamp: Date.now(),
      platform: this.adapter.platform,
      sdk: { name: this.adapter.sdkName, version: this.adapter.sdkVersion },
      level,
      release: this.options.release,
      environment: this.options.environment,
      breadcrumbs: this.scopeStore.getBreadcrumbs().snapshot(),
    };
    if (user) event.user = user;
    if (tags.size > 0) event.tags = Object.fromEntries(tags);
    if (contexts.size > 0) event.contexts = Object.fromEntries(contexts);
    this.adapter.enrichEvent?.(event);
    return event;
  }

  private dispatch(event: EventPayload): string {
    if (!this.shouldSample()) return event.eventId;
    const scrubbed = this.scrubber.scrub(event);
    const chain = this.applyBeforeSend(scrubbed).then((final) => {
      if (final) this.transport.enqueue(final);
    });
    this.pending.add(chain);
    void chain.finally(() => this.pending.delete(chain));
    return event.eventId;
  }

  private shouldSample(): boolean {
    const rate = this.options.sampleRate ?? 1;
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    return Math.random() < rate;
  }

  private async applyBeforeSend(event: EventPayload): Promise<EventPayload | null> {
    if (!this.options.beforeSend) return event;
    try {
      return await this.options.beforeSend(event);
    } catch {
      return event;
    }
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
