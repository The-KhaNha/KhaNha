import { defineConfig } from 'vitest/config';

// Staging runs only the suites that create and clean up their own data (*.safe.test.ts); see docs/TESTING.md.
const stagingOnly = process.env.TEST_TARGET === 'staging';

export default defineConfig({
  test: {
    include: stagingOnly ? ['test/**/*.safe.test.ts'] : ['test/**/*.test.ts'],
    // One run at a time: parallel runs would reseed the shared database under each other.
    globalSetup: ['test/setup/run-lock.ts'],
    setupFiles: ['test/setup/guard.ts'],
    // Quiet by default; LOG_LEVEL=debug npm test shows the app's logs.
    env: { LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent' },
    // Suites share one database; running files one at a time keeps their data from colliding.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
