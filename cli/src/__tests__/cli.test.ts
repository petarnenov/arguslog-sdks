import { describe, expect, it } from 'vitest';

import { parseArgs, run } from '../cli.js';
import { VERSION } from '../version.js';

describe('parseArgs', () => {
  it('defaults to help when no command given', () => {
    expect(parseArgs([])).toEqual({ command: 'help', rest: [] });
  });

  it('splits command from rest', () => {
    expect(parseArgs(['releases', 'new', '1.2.3'])).toEqual({
      command: 'releases',
      rest: ['new', '1.2.3'],
    });
  });
});

describe('run', () => {
  it.each([['help'], ['--help'], ['-h']])('prints usage on %s', async (flag) => {
    const r = await run([flag]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stderr).toBe('');
  });

  it.each([['version'], ['--version'], ['-v']])('prints VERSION on %s', async (flag) => {
    const r = await run([flag]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  it('returns exit 1 for unknown command', async () => {
    const r = await run(['bogus']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('unknown command');
  });

  it('defaults to help when argv is empty', async () => {
    const r = await run([]);
    expect(r.exitCode).toBe(0);
  });

  it('rejects releases new without --project as usage error', async () => {
    const r = await run(['releases', 'new', '1.2.3'], {
      loadConfig: () => ({ apiBaseUrl: 'http://x', token: 't' }),
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--project');
  });

  it('rejects sourcemaps upload without --release as usage error', async () => {
    const r = await run(['sourcemaps', 'upload', './a.map', '--project', '1'], {
      loadConfig: () => ({ apiBaseUrl: 'http://x', token: 't' }),
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--release');
  });
});
