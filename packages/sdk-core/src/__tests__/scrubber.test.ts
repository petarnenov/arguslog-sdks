import { describe, expect, it } from 'vitest';

import { Scrubber } from '../scrubber.js';

describe('Scrubber', () => {
  it('redacts emails in strings', () => {
    const s = new Scrubber();
    expect(s.scrub('contact: user@example.com')).toBe('contact: [Filtered]');
  });

  it('redacts JWTs', () => {
    const s = new Scrubber();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc';
    expect(s.scrub(`token=${jwt}`)).toBe('token=[Filtered]');
  });

  it('redacts Bearer tokens', () => {
    const s = new Scrubber();
    expect(s.scrub('auth: Bearer abc.def-ghi')).toBe('auth: [Filtered]');
  });

  it('redacts sensitive object keys', () => {
    const s = new Scrubber();
    const out = s.scrub({ password: 'secret', authorization: 'x', name: 'Pesho' });
    expect(out).toEqual({ password: '[Filtered]', authorization: '[Filtered]', name: 'Pesho' });
  });

  it('walks nested structures', () => {
    const s = new Scrubber();
    const out = s.scrub({ user: { email: 'a@b.com', tags: ['x@y.com'] } });
    expect(out).toEqual({ user: { email: '[Filtered]', tags: ['[Filtered]'] } });
  });

  it('handles circular references', () => {
    const s = new Scrubber();
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => s.scrub(obj)).not.toThrow();
  });

  it('respects enabled=false', () => {
    const s = new Scrubber({ enabled: false });
    expect(s.scrub('a@b.com')).toBe('a@b.com');
  });

  it('applies extra patterns', () => {
    const s = new Scrubber({ extraPatterns: [/SECRET-\w+/g] });
    expect(s.scrub('SECRET-12345 leaked')).toBe('[Filtered] leaked');
  });
});
