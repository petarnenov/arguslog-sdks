import type { ArguslogClient, Level } from '@arguslog/sdk-core';

/**
 * Patches {@code window.fetch} so every request leaves a breadcrumb. Records method + URL
 * pre-flight, then on resolution records the status (and duration). The original response is
 * passed through untouched.
 *
 * <p>For 4xx/5xx responses the integration also peeks at the response body and stamps a
 * preview ({@link #BODY_PREVIEW_CAP_BYTES} max, JSON / text content types only) into
 * {@code data.responsePreview} — the difference between "POST /api/orgs/1/billing/... → 502"
 * and "...→ 502, body: {error: NowPaymentsAuthFailed}" is how fast you find the bug. The peek
 * uses {@link Response.clone} so user code's await response.json() still works.
 */
const BODY_PREVIEW_CAP_BYTES = 4096;
const TEXTUAL_CONTENT_TYPES = /^(application\/(json|.*\+json)|text\/)/i;

export function installFetchBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => {};

  // Keep the function reference unbound — uninstall must hand the same object back to
  // window.fetch, otherwise tests that compare references break and downstream patches that
  // expect an unmodified prototype get confused.
  const original = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const start = Date.now();
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = requestUrl(input);
    try {
      const response = await Reflect.apply(original, window, [input, init]);
      try {
        const level: Level =
          response.status >= 500 ? 'error' : response.status >= 400 ? 'warning' : 'info';
        const data: Record<string, unknown> = {
          method,
          url,
          status: response.status,
          durationMs: Date.now() - start,
        };
        if (response.status >= 400) {
          const preview = await responseBodyPreview(response);
          if (preview !== undefined) data.responsePreview = preview;
        }
        client.addBreadcrumb({
          category: 'fetch',
          message: `${method} ${url} → ${response.status}`,
          level,
          data,
        });
      } catch {
        // best-effort
      }
      return response;
    } catch (err) {
      try {
        client.addBreadcrumb({
          category: 'fetch',
          message: `${method} ${url} — network error`,
          level: 'error',
          data: { method, url, error: errorMessage(err), durationMs: Date.now() - start },
        });
      } catch {
        // best-effort
      }
      throw err;
    }
  };

  return () => {
    if (window.fetch !== original) window.fetch = original;
  };
}

async function responseBodyPreview(response: Response): Promise<string | undefined> {
  // Skip binary content — gzipped/octet-stream/image bytes wouldn't be readable as a
  // breadcrumb anyway and would just bloat the payload.
  const contentType = response.headers.get('content-type') ?? '';
  if (!TEXTUAL_CONTENT_TYPES.test(contentType)) return undefined;
  try {
    // .clone() lets the user's downstream await response.json() still work — the body
    // stream isn't drained by our peek.
    const text = await response.clone().text();
    if (text.length <= BODY_PREVIEW_CAP_BYTES) return text;
    return text.slice(0, BODY_PREVIEW_CAP_BYTES) + '… (truncated)';
  } catch {
    return undefined;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
