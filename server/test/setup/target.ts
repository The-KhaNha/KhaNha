// Decides which Supabase project a test run may touch. Runs before any test file imports the app.
//   TEST_TARGET=local (default)  APP_ENV=local and SUPABASE_URL on 127.0.0.1/localhost; every suite runs.
//   TEST_TARGET=staging          refused unless ALLOW_STAGING_TESTS=1, TEST_STAGING_HOST is set, and
//                                SUPABASE_URL host matches it; then only *.safe.test.ts suites run.
//   TEST_TARGET=production       always refused.
export type TestTarget = 'local' | 'staging';

export function resolveTestTarget(env: NodeJS.ProcessEnv = process.env): TestTarget {
  const target = env.TEST_TARGET ?? 'local';

  if (target === 'local') {
    if (env.APP_ENV !== 'local') {
      throw new Error(
        `Tests refuse to run: TEST_TARGET=local needs APP_ENV=local (found ${env.APP_ENV}).`,
      );
    }
    const host = safeHost(env.SUPABASE_URL);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(
        `Tests refuse to run: SUPABASE_URL must be local Supabase (found host ${host}).`,
      );
    }
    return 'local';
  }

  if (target === 'staging') {
    if (env.ALLOW_STAGING_TESTS !== '1') {
      throw new Error('Tests refuse to run on staging unless ALLOW_STAGING_TESTS=1.');
    }
    if (env.APP_ENV !== 'staging') {
      throw new Error(
        `Tests refuse to run: TEST_TARGET=staging needs APP_ENV=staging (found ${env.APP_ENV}).`,
      );
    }
    const stagingHost = env.TEST_STAGING_HOST;
    if (!stagingHost) {
      throw new Error('Tests refuse to run: TEST_TARGET=staging needs TEST_STAGING_HOST set.');
    }
    const host = safeHost(env.SUPABASE_URL);
    if (host !== stagingHost) {
      throw new Error(
        `Tests refuse to run: TEST_TARGET=staging needs SUPABASE_URL on ${stagingHost} (found ${host}).`,
      );
    }
    return 'staging';
  }

  throw new Error(`Tests never run against TEST_TARGET=${target}.`);
}

function safeHost(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}
