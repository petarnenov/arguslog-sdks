import { describe, expect, it } from 'vitest';

import { parseStack } from '../stack-parser.js';

describe('parseStack', () => {
  it('parses a Chrome-style stack', () => {
    const stack = `Error: boom
    at foo (https://app.example.com/main.js:10:15)
    at bar (https://app.example.com/main.js:5:3)`;
    const frames = parseStack(stack);
    expect(frames.length).toBeGreaterThan(0);
    const top = frames[frames.length - 1];
    expect(top?.function).toBe('foo');
    expect(top?.filename).toBe('https://app.example.com/main.js');
    expect(top?.lineno).toBe(10);
  });

  it('parses a Firefox-style stack', () => {
    const stack = `foo@https://app.example.com/main.js:10:15
bar@https://app.example.com/main.js:5:3`;
    const frames = parseStack(stack);
    expect(frames.length).toBe(2);
    expect(frames[frames.length - 1]?.function).toBe('foo');
  });

  it('returns empty for missing stack', () => {
    expect(parseStack(undefined)).toEqual([]);
  });
});
