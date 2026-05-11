import { __resetForTests } from '@arguslog/sdk-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';

import { ArguslogService } from '../arguslog-service.js';
import { useArguslog } from '../composable.js';
import { ARGUSLOG_KEY } from '../injection-keys.js';
import { createArguslog } from '../plugin.js';

describe('useArguslog', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
  });

  it('returns the service provided by the plugin', () => {
    let captured: ArguslogService | null = null;
    let provided: ArguslogService | null = null;
    const Probe = defineComponent({
      setup() {
        captured = useArguslog();
        provided = (Probe as never as { _context?: never })._context ?? null;
        return () => h('span');
      },
    });
    const app = createApp(Probe);
    app.use(
      createArguslog({
        dsn: 'arguslog://k@localhost:8080/api/1',
        transport: {
          fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
        },
      }),
    );
    app.mount(document.createElement('div'));

    expect(captured).toBeInstanceOf(ArguslogService);
    expect(captured).toBe(app._context.provides[ARGUSLOG_KEY as unknown as symbol]);
    app.unmount();
    void provided;
  });

  it('falls back to a fresh service when no plugin is installed', () => {
    let captured: ArguslogService | null = null;
    const Probe = defineComponent({
      setup() {
        captured = useArguslog();
        return () => h('span');
      },
    });
    const app = createApp(Probe);
    app.mount(document.createElement('div'));
    expect(captured).toBeInstanceOf(ArguslogService);
    app.unmount();
  });

  it('returns a fresh service when called outside a Vue setup', () => {
    expect(useArguslog()).toBeInstanceOf(ArguslogService);
  });
});
