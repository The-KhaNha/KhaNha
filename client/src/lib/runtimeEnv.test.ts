import { describe, expect, it } from 'vitest';
import { resolveRuntimeEnv } from './runtimeEnv';

const build = {
  SUPABASE_URL: 'https://build.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build',
  LOG_LEVEL: 'warn',
};

describe('resolveRuntimeEnv', () => {
  it('prefers the runtime value over the build value', () => {
    const env = resolveRuntimeEnv(
      { SUPABASE_URL: 'https://runtime.supabase.co', REQUEST_TIMEOUT_MS: '8000' },
      build,
    );
    expect(env.supabaseUrl).toBe('https://runtime.supabase.co');
    expect(env.requestTimeoutMs).toBe(8000);
  });

  it('falls back to the build value when the runtime one is unset', () => {
    const env = resolveRuntimeEnv({}, build);
    expect(env).toEqual({
      supabaseUrl: 'https://build.supabase.co',
      supabasePublishableKey: 'sb_publishable_build',
      logLevel: 'warn',
      requestTimeoutMs: 15_000,
    });
  });

  it('treats an empty runtime value as unset', () => {
    const env = resolveRuntimeEnv(
      { SUPABASE_URL: '', LOG_LEVEL: '  ', REQUEST_TIMEOUT_MS: '' },
      build,
    );
    expect(env.supabaseUrl).toBe('https://build.supabase.co');
    expect(env.logLevel).toBe('warn');
    expect(env.requestTimeoutMs).toBe(15_000);
  });

  it('ignores a timeout that is not a positive whole number', () => {
    expect(resolveRuntimeEnv({ REQUEST_TIMEOUT_MS: 'soon' }, {}).requestTimeoutMs).toBe(15_000);
    expect(resolveRuntimeEnv({ REQUEST_TIMEOUT_MS: '-5' }, {}).requestTimeoutMs).toBe(15_000);
  });
});
