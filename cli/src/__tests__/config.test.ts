import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CliConfigError, credentialsPath, loadConfig } from '../config.js';

function tmpHome(file: string | null): string {
  const home = mkdtempSync(join(tmpdir(), 'arglog-cfg-'));
  if (file !== null) {
    mkdirSync(join(home, '.arguslog'));
    writeFileSync(join(home, '.arguslog', 'credentials'), file);
  }
  return home;
}

describe('loadConfig', () => {
  it('prefers ARGUSLOG_TOKEN env var even when no credentials file exists', () => {
    const config = loadConfig({
      ARGUSLOG_TOKEN: 'arglog_pat_envtok',
      ARGUSLOG_API_URL: 'https://api.example',
      HOME: '/nonexistent',
    });
    expect(config.token).toBe('arglog_pat_envtok');
    expect(config.apiBaseUrl).toBe('https://api.example');
  });

  it('falls back to ~/.arguslog/credentials when env is unset', () => {
    const home = tmpHome('{"token": "arglog_pat_filetok", "apiBaseUrl": "https://api.x"}');
    const config = loadConfig({ HOME: home });
    expect(config.token).toBe('arglog_pat_filetok');
    expect(config.apiBaseUrl).toBe('https://api.x');
  });

  it('throws CliConfigError with a helpful message when no creds anywhere', () => {
    expect(() => loadConfig({ HOME: '/no/such/dir' })).toThrow(CliConfigError);
  });

  it('throws when the credentials file is invalid JSON', () => {
    const home = tmpHome('not-json{');
    expect(() => loadConfig({ HOME: home })).toThrow(/not valid JSON/);
  });

  it('throws when the credentials file lacks a token', () => {
    const home = tmpHome('{"apiBaseUrl": "https://api.x"}');
    expect(() => loadConfig({ HOME: home })).toThrow(/token/);
  });

  it('credentialsPath honors $HOME', () => {
    expect(credentialsPath({ HOME: '/h' })).toBe('/h/.arguslog/credentials');
  });
});
