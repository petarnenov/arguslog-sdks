import type { CliConfig } from './config.js';

export interface ProblemDetail {
  title: string;
  status: number;
  detail?: string;
  type?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ProblemDetail,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

/**
 * Typed fetch around the Arguslog api. Bearer token comes from the loaded config; non-2xx responses
 * surface as {@link ApiError} carrying the parsed RFC 9457 problem+json body when available.
 */
export async function apiFetch<T>(
  config: CliConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${config.apiBaseUrl}${path}`;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${config.token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    throw new ApiError(res.status, await readProblem(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function readProblem(res: Response): Promise<ProblemDetail> {
  const ct = res.headers.get('Content-Type') ?? '';
  if (ct.includes('json')) {
    try {
      return (await res.json()) as ProblemDetail;
    } catch {
      // fall through
    }
  }
  return { title: `HTTP ${res.status}`, status: res.status, detail: res.statusText };
}
