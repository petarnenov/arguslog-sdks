const DEFAULT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { name: 'creditCard', re: /\b(?:\d[ -]*?){13,19}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*\b/g },
  { name: 'ipv4', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9-_.~+/=]+/gi },
];

const SENSITIVE_KEYS =
  /^(password|passwd|secret|authorization|cookie|api[_-]?key|token|x-api-key)$/i;

const REDACTED = '[Filtered]';

export interface ScrubberOptions {
  enabled?: boolean;
  extraPatterns?: RegExp[];
}

export class Scrubber {
  private readonly patterns: RegExp[];
  private readonly enabled: boolean;

  constructor(opts: ScrubberOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.patterns = [...DEFAULT_PATTERNS.map((p) => p.re), ...(opts.extraPatterns ?? [])];
  }

  scrub<T>(value: T): T {
    if (!this.enabled) return value;
    return this.walk(value, new WeakSet()) as T;
  }

  private walk(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return this.scrubString(value);
    if (typeof value !== 'object') return value;
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((v) => this.walk(v, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? REDACTED : this.walk(v, seen);
    }
    return out;
  }

  private scrubString(input: string): string {
    let out = input;
    for (const re of this.patterns) {
      out = out.replace(re, REDACTED);
    }
    return out;
  }
}
