import 'dotenv/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Staging runs only the suites that create and clean up their own data (*.safe.test.ts); see docs/TESTING.md.
// dotenv (above) loads server/.env before this runs, so this reads TEST_TARGET from the same source as
// resolveTestTarget() in test/setup/target.ts (also `import 'dotenv/config'`, in guard.ts). Without this import,
// a TEST_TARGET set only in .env (not the shell) would compute stagingOnly=false here — including the
// destructive suites — while resolveTestTarget() still saw 'staging' and let the run proceed.
// Manual check: with only server/.env containing TEST_TARGET=staging (nothing exported in the shell), run
// `pnpm exec vitest list` and confirm only *.safe.test.ts files are listed.
const stagingOnly = process.env.TEST_TARGET === 'staging';

export default defineConfig({
  test: {
    include: stagingOnly ? ['test/**/*.safe.test.ts'] : ['test/**/*.test.ts'],
    // One run at a time: parallel runs would reseed the shared database under each other.
    globalSetup: ['test/setup/run-lock.ts'],
    setupFiles: ['test/setup/guard.ts'],
    // Quiet by default; LOG_LEVEL=debug pnpm test shows the app's logs.
    env: {
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
      // The suites fire hundreds of writes a minute as one user from one address; the limiter itself is tested
      // through its factory in test/unit/rate-limit.safe.test.ts.
      RATE_LIMIT_IP_MAX: process.env.RATE_LIMIT_IP_MAX ?? '0',
      RATE_LIMIT_WRITE_MAX: process.env.RATE_LIMIT_WRITE_MAX ?? '0',
      RATE_LIMIT_REGISTER_MAX: process.env.RATE_LIMIT_REGISTER_MAX ?? '0',
      RATE_LIMIT_UPLOAD_MAX: process.env.RATE_LIMIT_UPLOAD_MAX ?? '0',
      // Photos go to a throwaway folder, never the developer's own .media.
      MEDIA_STORAGE: 'local',
      MEDIA_LOCAL_DIR: join(tmpdir(), 'khanha-test-media'),
      // The S3 store's suite (media-s3.test.ts) runs against RustFS: compose's `media` service locally, a container in CI.
      MEDIA_BUCKET: 'khanha-test',
      MEDIA_S3_ENDPOINT: process.env.MEDIA_S3_ENDPOINT ?? 'http://127.0.0.1:9000',
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'rustfsadmin',
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'rustfsadmin',
    },
    // Suites share one database; running files one at a time keeps their data from colliding.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
