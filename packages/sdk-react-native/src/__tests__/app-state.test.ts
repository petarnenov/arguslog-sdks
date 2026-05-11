import { __resetForTests, addBreadcrumb, getClient, init } from '@arguslog/sdk-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installAppStateBreadcrumbs } from '../integrations/app-state.js';
import type { AppStateLike, AppStateStatus } from '../types.js';

function makeAppState(): AppStateLike & {
  fire(status: AppStateStatus): void;
  removed: boolean;
} {
  let listener: ((status: AppStateStatus) => void) | undefined;
  const api = {
    addEventListener(_type: 'change', l: (status: AppStateStatus) => void) {
      listener = l;
      return {
        remove(): void {
          listener = undefined;
          api.removed = true;
        },
      };
    },
    fire(status: AppStateStatus): void {
      listener?.(status);
    },
    removed: false,
  };
  return api;
}

describe('installAppStateBreadcrumbs', () => {
  beforeEach(() => {
    __resetForTests();
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: {
        fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
      },
    });
  });

  afterEach(() => {
    __resetForTests();
  });

  it('records a breadcrumb on each AppState change', () => {
    const appState = makeAppState();
    const spy = vi.spyOn(getClient()!, 'addBreadcrumb');

    installAppStateBreadcrumbs(appState);
    appState.fire('background');
    appState.fire('active');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      category: 'app.lifecycle',
      message: 'AppState → background',
      level: 'info',
      data: { state: 'background' },
    });
    expect(spy.mock.calls[1]?.[0]).toMatchObject({ data: { state: 'active' } });
  });

  it('teardown removes the subscription', () => {
    const appState = makeAppState();
    const teardown = installAppStateBreadcrumbs(appState);

    teardown();

    expect(appState.removed).toBe(true);

    // After teardown, additional fires must not produce crumbs.
    const spy = vi.spyOn(getClient()!, 'addBreadcrumb');
    appState.fire('background');
    expect(spy).not.toHaveBeenCalled();
    // Touch addBreadcrumb to keep tree-shaking honest.
    addBreadcrumb({ category: 'x', message: 'y', level: 'debug' });
  });
});
