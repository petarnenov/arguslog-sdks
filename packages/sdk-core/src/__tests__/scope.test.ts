import { describe, expect, it } from 'vitest';

import { GlobalScope } from '../scope.js';

describe('GlobalScope', () => {
  it('round-trips user/tags/contexts', () => {
    const s = new GlobalScope(50);
    s.setUser({ id: 'u1' });
    s.setTag('region', 'eu');
    s.setContext('session', { id: 's1' });
    expect(s.getUser()).toEqual({ id: 'u1' });
    expect(s.getTags().get('region')).toBe('eu');
    expect(s.getContexts().get('session')).toEqual({ id: 's1' });
  });

  it('breadcrumb buffer respects max', () => {
    const s = new GlobalScope(2);
    const buf = s.getBreadcrumbs();
    buf.add({ timestamp: 1, category: 'a', message: 'a', level: 'info' });
    buf.add({ timestamp: 2, category: 'b', message: 'b', level: 'info' });
    buf.add({ timestamp: 3, category: 'c', message: 'c', level: 'info' });
    expect(buf.snapshot().map((b) => b.message)).toEqual(['b', 'c']);
  });

  it('fork inherits tags and contexts but not user, and uses a fresh breadcrumb buffer', () => {
    const parent = new GlobalScope(50);
    parent.setUser({ id: 'parent-user' });
    parent.setTag('service', 'api');
    parent.setContext('build', { sha: 'abc' });
    parent.getBreadcrumbs().add({
      timestamp: 1,
      category: 'app',
      message: 'parent crumb',
      level: 'info',
    });

    const child = parent.fork();
    expect(child.getUser()).toBeUndefined();
    expect(child.getTags().get('service')).toBe('api');
    expect(child.getContexts().get('build')).toEqual({ sha: 'abc' });
    expect(child.getBreadcrumbs().snapshot()).toEqual([]);
  });

  it('mutations on a forked child do not leak to the parent', () => {
    const parent = new GlobalScope(50);
    parent.setTag('service', 'api');
    const child = parent.fork();
    child.setTag('region', 'eu');
    child.setUser({ id: 'req-user' });
    expect(parent.getTags().has('region')).toBe(false);
    expect(parent.getUser()).toBeUndefined();
    expect(child.getTags().get('service')).toBe('api');
    expect(child.getTags().get('region')).toBe('eu');
  });

  it('forked children preserve the breadcrumb capacity of the parent', () => {
    const parent = new GlobalScope(3);
    const child = parent.fork();
    const buf = child.getBreadcrumbs();
    for (let i = 0; i < 5; i++) {
      buf.add({ timestamp: i, category: 'a', message: `m${i}`, level: 'info' });
    }
    expect(buf.snapshot()).toHaveLength(3);
  });
});
