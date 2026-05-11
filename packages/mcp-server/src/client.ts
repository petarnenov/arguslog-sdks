/**
 * Thin HTTP client wrapping the Arguslog REST API. Authenticates with a Personal Access Token
 * from the dashboard's "Personal access tokens" page; PAT scopes (e.g. {@code orgs:write},
 * {@code releases:write}) determine which tools the agent can actually invoke at runtime.
 *
 * <p>Reads config from environment so no secrets land in the MCP client config:
 * <ul>
 *   <li>{@code ARGUSLOG_PAT} — required, the bearer token (format {@code arglog_pat_<rest>})</li>
 *   <li>{@code ARGUSLOG_API_URL} — optional, defaults to {@code https://api.arguslog.org}</li>
 * </ul>
 */

export interface ArguslogClientConfig {
  baseUrl: string;
  pat: string;
}

export class ArguslogApiError extends Error {
  readonly status: number;
  readonly problem: Record<string, unknown> | null;
  readonly url: string;

  constructor(status: number, url: string, problem: Record<string, unknown> | null) {
    const detail =
      (problem && typeof problem === 'object'
        ? String((problem.detail as string) ?? (problem.title as string) ?? '')
        : '') || `HTTP ${status}`;
    super(`${status} ${url}: ${detail}`);
    this.status = status;
    this.url = url;
    this.problem = problem;
  }
}

export class ArguslogClient {
  constructor(private readonly cfg: ArguslogClientConfig) {}

  static fromEnv(): ArguslogClient {
    const pat = process.env.ARGUSLOG_PAT;
    if (!pat || !pat.trim()) {
      throw new Error(
        'ARGUSLOG_PAT is not set. Generate a Personal Access Token from the Arguslog ' +
          'dashboard (/me/tokens) and pass it via the ARGUSLOG_PAT environment variable.',
      );
    }
    const baseUrl = (process.env.ARGUSLOG_API_URL ?? 'https://api.arguslog.org').replace(/\/+$/, '');
    return new ArguslogClient({ baseUrl, pat });
  }

  /**
   * Issue an authenticated request. {@code path} is the {@code /api/v1/...} suffix; query +
   * body are JSON-serialized when present. 4xx / 5xx responses parse the RFC 9457 problem
   * body and surface as {@link ArguslogApiError}.
   */
  async request<T = unknown>(opts: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<T> {
    const url = new URL(this.cfg.baseUrl + opts.path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
        else url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.pat}`,
      Accept: 'application/json',
      'User-Agent': '@arguslog/mcp-server',
      ...(opts.headers ?? {}),
    };
    let body: string | undefined;
    if (opts.body !== undefined && opts.body !== null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, { method: opts.method, headers, body });
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    const parsed =
      contentType.includes('json') && text.length > 0
        ? safeJsonParse(text)
        : text.length > 0
          ? text
          : null;

    if (!res.ok) {
      const problem =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      throw new ArguslogApiError(res.status, url.toString(), problem);
    }
    return parsed as T;
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
