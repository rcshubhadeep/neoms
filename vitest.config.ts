import { defineConfig } from 'vitest/config';
process.loadEnvFile('.env');
process.env.SUMMARY_QUEUE = 'summary-tests';
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
