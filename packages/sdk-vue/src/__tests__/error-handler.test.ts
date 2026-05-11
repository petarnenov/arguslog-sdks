import { __resetForTests, getClient, init } from '@arguslog/sdk-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';

import { installVueErrorHandler, vueErrorHandler } from '../error-handler.js';

function createTestApp() {
  return createApp(defineComponent({ setup: () => () => h('span') }));
}

describe('error-handler', () => {
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
    vi.restoreAllMocks();
  });

  it('vueErrorHandler forwards to captureException with framework tags', () => {
    const spy = vi.spyOn(getClient()!, 'captureException');
    const err = new Error('inline');
    vueErrorHandler(err, null, 'setup function');
    expect(spy).toHaveBeenCalledWith(err, {
      tags: { framework: 'vue', vueInfo: 'setup function' },
    });
  });

  it('installVueErrorHandler chains existing errorHandler', () => {
    const app = createTestApp();
    const previous = vi.fn();
    app.config.errorHandler = previous;

    const uninstall = installVueErrorHandler(app);
    const captureSpy = vi.spyOn(getClient()!, 'captureException');

    const err = new Error('chained');
    app.config.errorHandler!(err, null, 'render');

    expect(captureSpy).toHaveBeenCalledWith(err, {
      tags: { framework: 'vue', vueInfo: 'render' },
    });
    expect(previous).toHaveBeenCalledWith(err, null, 'render');

    uninstall();
    expect(app.config.errorHandler).toBe(previous);
  });

  it('uninstall restores undefined when no handler was previously set', () => {
    const app = createTestApp();
    const uninstall = installVueErrorHandler(app);
    expect(app.config.errorHandler).toBeTypeOf('function');
    uninstall();
    expect(app.config.errorHandler).toBeUndefined();
  });
});
