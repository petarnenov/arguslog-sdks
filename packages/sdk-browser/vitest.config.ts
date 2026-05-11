import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/*.pact.test.ts', '**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/index.ts'],
      // Branch threshold sits below the others because the browser integrations
      // (worker-errors / visibility / dom-breadcrumbs / web-vitals) have a lot of
      // try/catch best-effort fallbacks around browser APIs that are awkward to
      // simulate in jsdom — the catch arm only fires when the user agent has
      // mismatched / weird behaviour. Raising this to 70 would require either
      // dropping the defensive try/catch (worse) or stubbing browser APIs that
      // jsdom doesn't ship (Worker, navigator.serviceWorker, PerformanceObserver).
      thresholds: { statements: 75, branches: 60, functions: 75, lines: 75 },
    },
  },
});
