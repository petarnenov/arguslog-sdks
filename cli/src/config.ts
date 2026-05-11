import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CliConfig {
  apiBaseUrl: string;
  token: string;
}

export class CliConfigError extends Error {}

const DEFAULT_API_BASE_URL = 'http://localhost:8081';

/**
 * Resolves CLI credentials in this order:
 *   1. `ARGUSLOG_TOKEN` + `ARGUSLOG_API_URL` env vars (if both present)
 *   2. `~/.arguslog/credentials` JSON: { token, apiBaseUrl }
 *   3. Throws CliConfigError otherwise — there is no anonymous mode.
 *
 * Env wins so CI can plumb a token without clobbering the user's local file.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const envToken = env.ARGUSLOG_TOKEN?.trim();
  if (envToken) {
    return {
      token: envToken,
      apiBaseUrl: env.ARGUSLOG_API_URL?.trim() || DEFAULT_API_BASE_URL,
    };
  }
  const path = credentialsPath(env);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new CliConfigError(
      `No credentials at ${path} and ARGUSLOG_TOKEN is unset. ` +
        `Create a token in the dashboard and put { "token": "...", "apiBaseUrl": "..." } in ${path}.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliConfigError(`Credentials file ${path} is not valid JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new CliConfigError(`Credentials file ${path} must contain a JSON object.`);
  }
  const obj = parsed as Record<string, unknown>;
  const token = typeof obj.token === 'string' ? obj.token.trim() : '';
  if (!token) {
    throw new CliConfigError(`Credentials file ${path} is missing required "token" field.`);
  }
  const apiBaseUrl =
    typeof obj.apiBaseUrl === 'string' && obj.apiBaseUrl.trim()
      ? obj.apiBaseUrl.trim()
      : DEFAULT_API_BASE_URL;
  return { token, apiBaseUrl };
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? homedir();
  return join(home, '.arguslog', 'credentials');
}
