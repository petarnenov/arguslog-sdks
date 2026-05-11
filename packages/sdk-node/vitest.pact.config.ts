import { defineConfig } from 'vitest/config';

// Pact tests are slow (spawn a real Ruby mock server) and only meaningful in a
// dedicated run that emits the JSON contracts. Kept on a separate config so the
// regular `pnpm test` stays fast and the JS coverage gate ignores them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.pact.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
