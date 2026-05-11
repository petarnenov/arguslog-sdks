import { afterEach, describe, expect, it, vi } from 'vitest';

import { __resetForTests, init } from '../index.js';
import { enableSourceMaps, isSourceMapsEnabled } from '../integrations/sourcemaps.js';

describe('sourcemaps integration', () => {
  // Source-maps enablement is a process-global setting; remember the prior value so a single
  // test can't permanently flip it for the rest of the suite.
  const originalEnabled = isSourceMapsEnabled();

  afterEach(() => {
    __resetForTests();
    if (typeof process.setSourceMapsEnabled === 'function') {
      process.setSourceMapsEnabled(originalEnabled);
    }
    vi.restoreAllMocks();
  });

  it('enableSourceMaps flips the process-wide flag', () => {
    if (typeof process.setSourceMapsEnabled !== 'function') return; // pre-Node-16.6
    process.setSourceMapsEnabled(false);
    enableSourceMaps();
    expect(isSourceMapsEnabled()).toBe(true);
  });

  it('init({ sourcemaps: { enabled: true } }) enables source maps', () => {
    if (typeof process.setSourceMapsEnabled !== 'function') return;
    process.setSourceMapsEnabled(false);
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      sourcemaps: { enabled: true },
    });
    expect(isSourceMapsEnabled()).toBe(true);
  });

  it('init() without sourcemaps does not flip the flag', () => {
    if (typeof process.setSourceMapsEnabled !== 'function') return;
    process.setSourceMapsEnabled(false);
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
    });
    expect(isSourceMapsEnabled()).toBe(false);
  });

  it('isSourceMapsEnabled returns a boolean', () => {
    expect(typeof isSourceMapsEnabled()).toBe('boolean');
  });
});
