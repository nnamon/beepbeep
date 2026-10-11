import { defineConfig } from 'vitest/config';

// Research benchmarks (bench/): slow, not part of npm test.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('bench'), __APP_BUILD__: JSON.stringify('bench'), __DEBUG__: 'false' },
  test: {
    include: ['bench/**/*.bench.ts'],
    environment: 'node',
    testTimeout: 24 * 3600 * 1000,
  },
});
