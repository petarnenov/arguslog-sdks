import { ENVIRONMENT_INITIALIZER, ErrorHandler } from '@angular/core';
import { __resetForTests, getClient } from '@arguslog/sdk-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArguslogErrorHandler } from '../error-handler.js';
import { buildProviders } from '../provide-arguslog.js';
import { ARGUSLOG_OPTIONS } from '../tokens.js';

describe('buildProviders', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
  });

  it('registers ARGUSLOG_OPTIONS, ErrorHandler, and an ENVIRONMENT_INITIALIZER', () => {
    const providers = buildProviders({
      dsn: 'arguslog://k@localhost:8080/api/1',
    });

    expect(providers).toHaveLength(3);
    expect(providers[0]).toMatchObject({ provide: ARGUSLOG_OPTIONS });
    expect(providers[1]).toMatchObject({ provide: ErrorHandler, useClass: ArguslogErrorHandler });
    expect(providers[2]).toMatchObject({
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
    });
  });

  it('initializer calls init() with the configured options', () => {
    const opts = {
      dsn: 'arguslog://k@localhost:8080/api/2',
      transport: {
        fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
      },
    };

    const providers = buildProviders(opts);
    const initProvider = providers[2] as { useValue: () => void };

    expect(getClient()).toBeUndefined();
    initProvider.useValue();
    expect(getClient()).toBeDefined();
  });
});
