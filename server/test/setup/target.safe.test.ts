import { describe, expect, it } from 'vitest';
import { resolveTestTarget } from './target';

const local = { APP_ENV: 'local', SUPABASE_URL: 'http://127.0.0.1:54321' };
// An obviously fake staging host, never a real project ref.
const STAGING_HOST = 'staging.example.test';

describe('resolveTestTarget', () => {
  it('defaults to local and accepts the local stack', () => {
    expect(resolveTestTarget(local)).toBe('local');
    expect(resolveTestTarget({ ...local, SUPABASE_URL: 'http://localhost:54321' })).toBe('local');
  });

  it.each([
    ['APP_ENV is not local', { ...local, APP_ENV: 'staging' }, /needs APP_ENV=local/],
    [
      'SUPABASE_URL is a hosted project',
      { ...local, SUPABASE_URL: 'https://abc.supabase.co' },
      /SUPABASE_URL must be local/,
    ],
    [
      'SUPABASE_URL is not a URL',
      { ...local, SUPABASE_URL: 'not a url' },
      /SUPABASE_URL must be local/,
    ],
    // The host must be exactly local, not merely start with it.
    [
      'SUPABASE_URL is a lookalike host',
      { ...local, SUPABASE_URL: 'http://127.0.0.1.evil.test:54321' },
      /SUPABASE_URL must be local/,
    ],
    [
      'SUPABASE_URL puts localhost in the user part',
      { ...local, SUPABASE_URL: 'http://localhost@evil.test' },
      /SUPABASE_URL must be local/,
    ],
  ])('refuses local when %s', (_label, env, message) => {
    expect(() => resolveTestTarget(env)).toThrow(message);
  });

  it('refuses staging without the explicit opt-in', () => {
    const staging = {
      TEST_TARGET: 'staging',
      APP_ENV: 'staging',
      TEST_STAGING_HOST: STAGING_HOST,
      SUPABASE_URL: `https://${STAGING_HOST}`,
    };
    expect(() => resolveTestTarget(staging)).toThrow(/ALLOW_STAGING_TESTS/);
    expect(resolveTestTarget({ ...staging, ALLOW_STAGING_TESTS: '1' })).toBe('staging');
  });

  it('refuses staging without TEST_STAGING_HOST set', () => {
    const staging = {
      TEST_TARGET: 'staging',
      ALLOW_STAGING_TESTS: '1',
      APP_ENV: 'staging',
      SUPABASE_URL: `https://${STAGING_HOST}`,
    };
    expect(() => resolveTestTarget(staging)).toThrow(/TEST_STAGING_HOST/);
  });

  it('refuses staging when SUPABASE_URL is not the staging project, opt-in or not', () => {
    const staging = {
      TEST_TARGET: 'staging',
      ALLOW_STAGING_TESTS: '1',
      APP_ENV: 'staging',
      TEST_STAGING_HOST: STAGING_HOST,
    };
    expect(() =>
      resolveTestTarget({ ...staging, SUPABASE_URL: 'https://some-other-project.supabase.co' }),
    ).toThrow(/SUPABASE_URL/);
    // The staging host as a prefix of another host is not the staging host.
    expect(() =>
      resolveTestTarget({ ...staging, SUPABASE_URL: `https://${STAGING_HOST}.evil.test` }),
    ).toThrow(/SUPABASE_URL/);
    // A prod-looking host must not slip through opt-in staging mode either.
    expect(() =>
      resolveTestTarget({ ...staging, SUPABASE_URL: 'https://production-project.supabase.co' }),
    ).toThrow(/SUPABASE_URL/);
  });

  it('never runs against production', () => {
    const never = /never run against TEST_TARGET=production/;
    expect(() => resolveTestTarget({ ...local, TEST_TARGET: 'production' })).toThrow(never);
    expect(() =>
      resolveTestTarget({ ...local, TEST_TARGET: 'production', ALLOW_STAGING_TESTS: '1' }),
    ).toThrow(never);
  });
});
