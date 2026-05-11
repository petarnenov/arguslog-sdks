import { __resetForTests, getClient } from '@arguslog/sdk-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, inject } from 'vue';

import { ArguslogService } from '../arguslog-service.js';
import { ARGUSLOG_KEY } from '../injection-keys.js';
import { createArguslog, type ArguslogPluginOptions } from '../plugin.js';

function mockTransport(): typeof fetch {
  return vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
}

function mountWithPlugin(options: ArguslogPluginOptions): {
  app: ReturnType<typeof createApp>;
  injected: ArguslogService | null;
} {
  let injected: ArguslogService | null = null;
  const Probe = defineComponent({
    setup() {
      injected = inject(ARGUSLOG_KEY, null);
      return () => h('span');
    },
  });
  const host = document.createElement('div');
  const app = createApp(Probe);
  app.use(createArguslog(options));
  app.mount(host);
  return { app, injected };
}

describe('createArguslog', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
  });

  it('initialises the browser SDK with the supplied options', () => {
    expect(getClient()).toBeUndefined();
    const { app } = mountWithPlugin({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: mockTransport() },
    });
    expect(getClient()).toBeDefined();
    app.unmount();
  });

  it('provides an ArguslogService through ARGUSLOG_KEY', () => {
    const { app, injected } = mountWithPlugin({
      dsn: 'arguslog://k@localhost:8080/api/2',
      transport: { fetch: mockTransport() },
    });
    expect(injected).toBeInstanceOf(ArguslogService);
    app.unmount();
  });

  it('replaces app.config.errorHandler so component errors are captured', () => {
    const { app } = mountWithPlugin({
      dsn: 'arguslog://k@localhost:8080/api/3',
      transport: { fetch: mockTransport() },
    });
    expect(typeof app.config.errorHandler).toBe('function');

    const captureSpy = vi.spyOn(getClient()!, 'captureException');
    app.config.errorHandler!(new Error('boom'), null, 'render');
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(captureSpy.mock.calls[0]?.[1]).toEqual({
      tags: { framework: 'vue', vueInfo: 'render' },
    });
    app.unmount();
  });

  it('skips errorHandler installation when attachErrorHandler is false', () => {
    const { app } = mountWithPlugin({
      dsn: 'arguslog://k@localhost:8080/api/4',
      attachErrorHandler: false,
      transport: { fetch: mockTransport() },
    });
    expect(app.config.errorHandler).toBeUndefined();
    app.unmount();
  });

  it('preserves a previously-installed errorHandler in the chain', () => {
    __resetForTests();
    const previous = vi.fn();
    const host = document.createElement('div');
    const app = createApp(defineComponent({ setup: () => () => h('span') }));
    app.config.errorHandler = previous;
    app.use(
      createArguslog({
        dsn: 'arguslog://k@localhost:8080/api/5',
        transport: { fetch: mockTransport() },
      }),
    );
    app.mount(host);

    app.config.errorHandler!(new Error('chained'), null, 'mounted');
    expect(previous).toHaveBeenCalledTimes(1);
    app.unmount();
  });
});
