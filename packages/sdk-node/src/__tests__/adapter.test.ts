import type { EventPayload } from '@arguslog/sdk-core';
import { describe, expect, it } from 'vitest';

import { NodeAdapter } from '../adapter.js';

function emptyEvent(): EventPayload {
  return {
    eventId: 'x',
    timestamp: 0,
    platform: 'node',
    sdk: { name: 'arguslog.node', version: '0.0.0' },
    level: 'error',
  };
}

describe('NodeAdapter', () => {
  it('reports node platform and sdk identity', () => {
    const a = new NodeAdapter();
    expect(a.platform).toBe('node');
    expect(a.sdkName).toBe('arguslog.node');
    // sdkVersion is generator-fed from package.json:version — assert shape, not literal.
    expect(a.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('enrichEvent attaches runtime and os contexts', () => {
    const a = new NodeAdapter();
    const ev = emptyEvent();
    a.enrichEvent(ev);
    expect(ev.contexts?.runtime).toEqual({ name: 'node', version: process.version });
    expect((ev.contexts?.os as { name: string }).name).toBeTruthy();
    expect((ev.contexts?.os as { release: string }).release).toBeTruthy();
  });

  it('preserves pre-existing contexts', () => {
    const a = new NodeAdapter();
    const ev = emptyEvent();
    ev.contexts = { custom: { foo: 'bar' } };
    a.enrichEvent(ev);
    expect(ev.contexts?.custom).toEqual({ foo: 'bar' });
    expect(ev.contexts?.runtime).toBeDefined();
  });
});
