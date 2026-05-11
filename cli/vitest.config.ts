import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/bin.ts', 'src/index.ts'],
      thresholds: { statements: 75, branches: 70, functions: 75, lines: 75 },
    },
  },
});
