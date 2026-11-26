// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
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
      hosts: { customer: undefined, staff: undefined, admin: undefined },
    });
  });

  it('reads the three host names, runtime first', () => {
    const env = resolveRuntimeEnv(
      { STAFF_HOST: 'staff.khanha.in', ADMIN_HOST: '' },
      { ...build, STAFF_HOST: 'staff.build', ADMIN_HOST: 'admin.build', CUSTOMER_HOST: 'build' },
    );
    expect(env.hosts).toEqual({
      customer: 'build',
      staff: 'staff.khanha.in',
      admin: 'admin.build',
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
    expect(resolveRuntimeEnv({ REQUEST_TIMEOUT_MS: '0' }, {}).requestTimeoutMs).toBe(15_000);
    expect(resolveRuntimeEnv({ REQUEST_TIMEOUT_MS: '2.5' }, {}).requestTimeoutMs).toBe(15_000);
  });
});

describe('runtimeEnv (the module-level value)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reads window.__RUNTIME_ENV__ when there is a window', async () => {
    vi.stubGlobal('window', { __RUNTIME_ENV__: { LOG_LEVEL: 'debug' } });
    vi.resetModules();
    expect((await import('./runtimeEnv')).runtimeEnv.logLevel).toBe('debug');
  });

  it('loads without a window and takes the build values', async () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'error');
    vi.stubEnv('VITE_REQUEST_TIMEOUT_MS', '9000');
    vi.stubEnv('VITE_STAFF_HOST', 'staff.build');
    vi.resetModules();
    const { runtimeEnv } = await import('./runtimeEnv');
    expect(runtimeEnv.logLevel).toBe('error');
    expect(runtimeEnv.requestTimeoutMs).toBe(9000);
    expect(runtimeEnv.hosts.staff).toBe('staff.build');
  });
});
