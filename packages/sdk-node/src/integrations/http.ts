import http from 'node:http';
import https from 'node:https';

import type { ArguslogClient } from '@arguslog/sdk-core';

const DSN_AUTH_HEADER = 'x-arguslog-auth';

/**
 * Patches Node's `http.request`, `https.request`, and `globalThis.fetch` so each outgoing HTTP
 * request becomes a breadcrumb (`{ category: 'http', message: 'GET https://…', data: { method,
 * url, status_code, duration_ms } }`). Returns an uninstall function that restores the originals.
 *
 * The SDK's own ingest requests are skipped — they carry the `X-Arguslog-Auth` header, which we
 * recognise to avoid recording breadcrumbs about our own outbound traffic (and the breadcrumb
 * spam that would create on the next event).
 */
export function installHttpInstrumentation(client: ArguslogClient): () => void {
  const undoFetch = patchFetch(client);
  const undoHttp = patchHttpModule(http, 'http:', client);
  const undoHttps = patchHttpModule(https, 'https:', client);
  return () => {
    undoFetch();
    undoHttp();
    undoHttps();
  };
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function patchFetch(client: ArguslogClient): () => void {
  const original = globalThis.fetch;
  const patched: typeof fetch = async (input, init) => {
    const start = Date.now();
    const method = extractFetchMethod(input, init);
    const url = extractFetchUrl(input);
    const isSdkOutbound = headersHaveDsnAuth(init?.headers ?? extractRequestHeaders(input));

    try {
      const res = await original(input, init);
      if (!isSdkOutbound) {
        client.addBreadcrumb({
          category: 'http',
          message: `${method} ${url}`,
          level: res.status >= 500 ? 'error' : res.status >= 400 ? 'warning' : 'info',
          data: {
            method,
            url,
            status_code: res.status,
            duration_ms: Date.now() - start,
          },
        });
      }
      return res;
    } catch (err) {
      if (!isSdkOutbound) {
        client.addBreadcrumb({
          category: 'http',
          message: `${method} ${url}`,
          level: 'error',
          data: {
            method,
            url,
            error: err instanceof Error ? err.message : String(err),
            duration_ms: Date.now() - start,
          },
        });
      }
      throw err;
    }
  };
  globalThis.fetch = patched;
  return () => {
    if (globalThis.fetch === patched) globalThis.fetch = original;
  };
}

function patchHttpModule(
  mod: typeof http | typeof https,
  scheme: 'http:' | 'https:',
  client: ArguslogClient,
): () => void {
  const original = mod.request.bind(mod);
  // The Node typings for http.request expose 4 overloads. We accept anything and forward.
  const patched: typeof http.request = ((...args: unknown[]) => {
    const start = Date.now();
    const { method, url, hasDsnAuth } = parseHttpArgs(args, scheme);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = (original as any)(...args) as http.ClientRequest;
    if (hasDsnAuth) return req;

    let recorded = false;
    const record = (statusCode: number | undefined, error?: string): void => {
      if (recorded) return;
      recorded = true;
      const level = error
        ? 'error'
        : statusCode && statusCode >= 500
          ? 'error'
          : statusCode && statusCode >= 400
            ? 'warning'
            : 'info';
      const data: Record<string, unknown> = {
        method,
        url,
        duration_ms: Date.now() - start,
      };
      if (statusCode !== undefined) data.status_code = statusCode;
      if (error) data.error = error;
      client.addBreadcrumb({
        category: 'http',
        message: `${method} ${url}`,
        level,
        data,
      });
    };

    req.on('response', (res) => record(res.statusCode));
    req.on('error', (err) => record(undefined, err.message));
    return req;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  mod.request = patched;
  return () => {
    if (mod.request === patched) mod.request = original;
  };
}

function extractFetchMethod(input: FetchInput, init: FetchInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function extractFetchUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function extractRequestHeaders(input: FetchInput): unknown {
  if (input instanceof Request) return input.headers;
  return undefined;
}

function headersHaveDsnAuth(headers: unknown): boolean {
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has(DSN_AUTH_HEADER);
  if (Array.isArray(headers)) {
    return headers.some(
      (entry) =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        entry[0].toLowerCase() === DSN_AUTH_HEADER,
    );
  }
  if (typeof headers === 'object') {
    return Object.keys(headers as Record<string, unknown>).some(
      (k) => k.toLowerCase() === DSN_AUTH_HEADER,
    );
  }
  return false;
}

interface ParsedHttpArgs {
  method: string;
  url: string;
  hasDsnAuth: boolean;
}

function parseHttpArgs(args: unknown[], scheme: 'http:' | 'https:'): ParsedHttpArgs {
  // http.request supports: (url), (url, options), (options) — with optional trailing callback.
  // We need: method, full URL, and whether the headers carry the SDK auth header.
  let urlPart: string | URL | undefined;
  let options: http.RequestOptions | undefined;
  for (const arg of args) {
    if (typeof arg === 'string' || arg instanceof URL) {
      urlPart = arg;
    } else if (arg && typeof arg === 'object' && !('call' in arg)) {
      options = arg as http.RequestOptions;
    }
  }
  const method = (options?.method ?? 'GET').toUpperCase();
  const url = formatUrl(urlPart, options, scheme);
  const hasDsnAuth = headersHaveDsnAuthRecord(options?.headers);
  return { method, url, hasDsnAuth };
}

function formatUrl(
  urlPart: string | URL | undefined,
  options: http.RequestOptions | undefined,
  scheme: 'http:' | 'https:',
): string {
  if (typeof urlPart === 'string') return urlPart;
  if (urlPart instanceof URL) return urlPart.href;
  const host = options?.hostname ?? options?.host ?? 'localhost';
  const port = options?.port ? `:${options.port}` : '';
  const path = options?.path ?? '/';
  return `${scheme}//${host}${port}${path}`;
}

function headersHaveDsnAuthRecord(headers: http.RequestOptions['headers']): boolean {
  if (!headers) return false;
  if (Array.isArray(headers)) {
    // OutgoingHttpHeaders allows readonly string[] (flat: [k, v, k, v, ...]).
    for (let i = 0; i < headers.length; i += 2) {
      if (headers[i]?.toLowerCase() === DSN_AUTH_HEADER) return true;
    }
    return false;
  }
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === DSN_AUTH_HEADER) return true;
  }
  return false;
}
