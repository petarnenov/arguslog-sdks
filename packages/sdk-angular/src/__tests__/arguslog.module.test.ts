import { describe, expect, it } from 'vitest';

import { ArguslogModule } from '../arguslog.module.js';

describe('ArguslogModule.forRoot', () => {
  it('returns ModuleWithProviders for ArguslogModule', () => {
    const result = ArguslogModule.forRoot({
      dsn: 'arguslog://k@localhost:8080/api/1',
    });

    expect(result.ngModule).toBe(ArguslogModule);
    expect(Array.isArray(result.providers)).toBe(true);
    expect(result.providers).toHaveLength(3);
  });
});
