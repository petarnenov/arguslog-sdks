import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/__tests__/**', 'src/client.ts', 'src/server.ts'],
      thresholds: { statements: 75, branches: 70, functions: 75, lines: 75 },
    },
  },
});
