import { describe, expect, it } from 'vitest';
import { resolveTestTarget } from './target';

const local = { APP_ENV: 'local', SUPABASE_URL: 'http://127.0.0.1:54321' };

describe('resolveTestTarget', () => {
  it('defaults to local and accepts the local stack', () => {
    expect(resolveTestTarget(local)).toBe('local');
    expect(resolveTestTarget({ ...local, SUPABASE_URL: 'http://localhost:54321' })).toBe('local');
  });

  it('refuses local when env points elsewhere', () => {
    expect(() => resolveTestTarget({ ...local, APP_ENV: 'staging' })).toThrow();
    expect(() =>
      resolveTestTarget({ ...local, SUPABASE_URL: 'https://abc.supabase.co' }),
    ).toThrow();
    expect(() => resolveTestTarget({ ...local, SUPABASE_URL: 'not a url' })).toThrow();
  });

  it('refuses staging without the explicit opt-in', () => {
    const staging = {
      TEST_TARGET: 'staging',
      APP_ENV: 'staging',
      SUPABASE_URL: 'https://xkddnlxeeizaqpefhqlv.supabase.co',
    };
    expect(() => resolveTestTarget(staging)).toThrow(/ALLOW_STAGING_TESTS/);
    expect(resolveTestTarget({ ...staging, ALLOW_STAGING_TESTS: '1' })).toBe('staging');
  });

  it('refuses staging when SUPABASE_URL is not the staging project, opt-in or not', () => {
    const staging = {
      TEST_TARGET: 'staging',
      ALLOW_STAGING_TESTS: '1',
      APP_ENV: 'staging',
    };
    expect(() =>
      resolveTestTarget({ ...staging, SUPABASE_URL: 'https://some-other-project.supabase.co' }),
    ).toThrow(/SUPABASE_URL/);
    // A prod-looking host must not slip through opt-in staging mode either.
    expect(() =>
      resolveTestTarget({ ...staging, SUPABASE_URL: 'https://production-project.supabase.co' }),
    ).toThrow(/SUPABASE_URL/);
  });

  it('never runs against production', () => {
    expect(() => resolveTestTarget({ ...local, TEST_TARGET: 'production' })).toThrow();
    expect(() =>
      resolveTestTarget({ ...local, TEST_TARGET: 'production', ALLOW_STAGING_TESTS: '1' }),
    ).toThrow();
  });
});
