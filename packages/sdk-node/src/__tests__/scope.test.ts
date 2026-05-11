import { describe, expect, it } from 'vitest';

import { AsyncLocalScopeStore } from '../scope.js';

describe('AsyncLocalScopeStore', () => {
  it('writes to the global fallback when no async context is active', () => {
    const s = new AsyncLocalScopeStore(50);
    s.setUser({ id: 'global' });
    s.setTag('service', 'api');
    expect(s.globalFallback().getUser()).toEqual({ id: 'global' });
    expect(s.globalFallback().getTags().get('service')).toBe('api');
  });

  it('redirects writes inside .run(child, ...) to the child scope', () => {
    const s = new AsyncLocalScopeStore(50);
    s.setTag('service', 'api'); // global

    const child = s.fork();
    s.run(child, () => {
      s.setUser({ id: 'req-1' });
      s.setTag('region', 'eu');
    });

    expect(s.globalFallback().getUser()).toBeUndefined();
    expect(s.globalFallback().getTags().has('region')).toBe(false);
    expect(child.getUser()).toEqual({ id: 'req-1' });
    expect(child.getTags().get('region')).toBe('eu');
  });

  it('isolates concurrent .run scopes (the per-request guarantee)', async () => {
    const s = new AsyncLocalScopeStore(50);

    async function handle(
      reqId: string,
      delayMs: number,
    ): Promise<{ user: string | undefined; region: string | undefined }> {
      const child = s.fork();
      return s.run(child, async () => {
        s.setUser({ id: reqId });
        s.setTag('region', reqId === 'A' ? 'eu' : 'us');
        await new Promise((r) => setTimeout(r, delayMs));
        return {
          user: s.getUser()?.id,
          region: s.getTags().get('region'),
        };
      });
    }

    const [a, b] = await Promise.all([handle('A', 20), handle('B', 5)]);
    expect(a).toEqual({ user: 'A', region: 'eu' });
    expect(b).toEqual({ user: 'B', region: 'us' });
  });

  it('forked scopes inherit tags/contexts from the active scope at fork time', () => {
    const s = new AsyncLocalScopeStore(50);
    s.setTag('service', 'api');
    const child = s.fork();
    expect(child.getTags().get('service')).toBe('api');
  });

  it('breadcrumbs added inside a request scope do not leak to the global fallback', () => {
    const s = new AsyncLocalScopeStore(50);
    const child = s.fork();
    s.run(child, () => {
      s.getBreadcrumbs().add({
        timestamp: 1,
        category: 'http',
        message: 'in-request',
        level: 'info',
      });
    });
    expect(s.globalFallback().getBreadcrumbs().snapshot()).toEqual([]);
    expect(child.getBreadcrumbs().snapshot()).toHaveLength(1);
  });
});
