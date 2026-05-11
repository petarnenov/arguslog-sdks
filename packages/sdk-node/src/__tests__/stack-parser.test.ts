import { describe, expect, it } from 'vitest';

import { parseStack } from '../stack-parser.js';

describe('parseStack (Node V8)', () => {
  it('parses a named frame', () => {
    const stack = `Error: boom
    at foo (/app/src/server.js:10:15)
    at bar (/app/src/server.js:5:3)`;
    const frames = parseStack(stack);
    expect(frames.length).toBe(2);
    const top = frames[frames.length - 1];
    expect(top?.function).toBe('foo');
    expect(top?.filename).toBe('/app/src/server.js');
    expect(top?.lineno).toBe(10);
    expect(top?.colno).toBe(15);
    expect(top?.inApp).toBe(true);
  });

  it('parses an anonymous frame (no fn label, no parens)', () => {
    const stack = `Error: boom
    at /app/src/server.js:10:15`;
    const frames = parseStack(stack);
    expect(frames.length).toBe(1);
    expect(frames[0]?.function).toBe('?');
    expect(frames[0]?.filename).toBe('/app/src/server.js');
  });

  it('parses async frames', () => {
    const stack = `Error: boom
    at async handleRequest (/app/src/server.js:42:7)`;
    const frames = parseStack(stack);
    expect(frames[0]?.function).toBe('handleRequest');
    expect(frames[0]?.lineno).toBe(42);
  });

  it('parses constructor frames (new ClassName)', () => {
    const stack = `Error: boom
    at new MyClass (/app/src/server.js:5:10)`;
    const frames = parseStack(stack);
    expect(frames[0]?.function).toBe('MyClass');
  });

  it('parses Object.<anonymous> form', () => {
    const stack = `Error: boom
    at Object.<anonymous> (/app/src/server.js:1:1)`;
    const frames = parseStack(stack);
    expect(frames[0]?.function).toBe('Object.<anonymous>');
  });

  it('marks node: internal frames as not in-app', () => {
    const stack = `Error: boom
    at Module._compile (node:internal/modules/cjs/loader:1234:5)`;
    const frames = parseStack(stack);
    expect(frames[0]?.inApp).toBe(false);
  });

  it('marks node_modules paths as not in-app', () => {
    const stack = `Error: boom
    at handler (/app/node_modules/express/lib/router.js:99:1)`;
    const frames = parseStack(stack);
    expect(frames[0]?.inApp).toBe(false);
  });

  it('returns empty for missing stack', () => {
    expect(parseStack(undefined)).toEqual([]);
  });

  it('skips non-frame lines (e.g. the leading Error: header)', () => {
    const stack = `Error: boom
    at foo (/app/server.js:1:1)
not a frame
    at bar (/app/server.js:2:1)`;
    const frames = parseStack(stack);
    expect(frames.length).toBe(2);
  });

  it('returns the bottom of the call stack last (caller-most-recent at the end)', () => {
    const stack = `Error: boom
    at top (/app/server.js:1:1)
    at middle (/app/server.js:2:1)
    at bottom (/app/server.js:3:1)`;
    const frames = parseStack(stack);
    // .reverse() puts the frame closest to the throw at the end of the array, matching
    // the browser SDK's convention (sentry-style "frames are in reverse order").
    expect(frames[frames.length - 1]?.function).toBe('top');
  });
});
