// env.ts parses through parseEnv(plain object), so every case runs in-process. Only what depends on the module-level load
// or on a process exiting (a bad env, refuseUnsafeProduction) spawns a child.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseEnv, productionProblems, resolveMediaStorage } from '../../src/utils/env';

const base = {
  APP_ENV: 'local',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

function parse(overrides: Record<string, string | undefined> = {}) {
  return parseEnv({ ...base, ...overrides });
}

/** The problems text of a refused env; fails the test when it was accepted. */
function problems(overrides: Record<string, string | undefined>): string {
  const result = parse(overrides);
  if (result.ok) throw new Error('expected the env to be refused');
  return result.problems;
}

describe('parseEnv messages', () => {
  it.each([
    [{ APP_ENV: 'dev' }, 'APP_ENV: APP_ENV must be one of local, staging, production.'],
    [{ APP_ENV: undefined }, 'APP_ENV: APP_ENV must be one of local, staging, production.'],
    [
      { LOG_LEVEL: 'loud' },
      'LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent.',
    ],
    [{ SUPABASE_URL: undefined }, 'SUPABASE_URL is required'],
    [{ SUPABASE_URL: 'not a url' }, 'SUPABASE_URL must be a URL'],
    [{ SUPABASE_SECRET_KEY: undefined }, 'SUPABASE_SECRET_KEY is required'],
    [{ SUPABASE_SECRET_KEY: 'eyJlegacy' }, 'must be a new-format secret key (sb_secret_...)'],
    [{ CLIENT_ORIGIN: 'nope' }, 'CLIENT_ORIGIN must be a URL'],
    [{ CLIENT_ORIGIN: 'https://a.example.com,nope' }, 'CLIENT_ORIGIN must be a URL'],
    [{ CLIENT_ORIGIN: 'https://a.example.com, https://b.example.com/' }, 'must be origins'],
  ])('%j fails with its own message', (overrides, expected) => {
    expect(problems(overrides)).toContain(expected);
  });

  it('coerces numeric strings and defaults when unset', () => {
    const ok = parse({ PORT: '9001', PUBLIC_READ_TTL_MS: '0' });
    expect(ok).toMatchObject({ ok: true, env: { PORT: 9001, PUBLIC_READ_TTL_MS: 0 } });
    expect(parse({ PORT: 'abc' }).ok).toBe(false);
    // The three hosts' list (P8 PR 05b), spaces after the commas allowed.
    const hosts = parse({ CLIENT_ORIGIN: 'https://a.example.com, https://b.example.com' });
    expect(hosts).toMatchObject({
      ok: true,
      env: { CLIENT_ORIGIN: ['https://a.example.com', 'https://b.example.com'] },
    });
  });
});

describe('parseEnv blank values', () => {
  it('treats a blank number as unset, so a rate limit keeps its default instead of turning off', () => {
    const result = parse({
      RATE_LIMIT_IP_MAX: '',
      RATE_LIMIT_WRITE_MAX: ' ',
      PUBLIC_READ_TTL_MS: '',
    });
    expect(result).toMatchObject({
      ok: true,
      env: { RATE_LIMIT_IP_MAX: 600, RATE_LIMIT_WRITE_MAX: 30, PUBLIC_READ_TTL_MS: 10_000 },
    });
  });

  it('still honours an explicit 0', () => {
    expect(parse({ RATE_LIMIT_IP_MAX: '0' })).toMatchObject({
      ok: true,
      env: { RATE_LIMIT_IP_MAX: 0 },
    });
  });
});

// The message must name the failing var and never echo the value back (it is a password).
describe('parseEnv SEED_STAFF_PASSWORD bound', () => {
  it('rejects an 11-character value, naming the var but never the value', () => {
    const value = 'elevenchar0';
    expect(value).toHaveLength(11);
    const text = problems({ SEED_STAFF_PASSWORD: value });
    expect(text).toContain('SEED_STAFF_PASSWORD');
    expect(text).toContain('at least 12 characters');
    expect(text).not.toContain(value);
  });

  it('accepts a 12-character value', () => {
    const value = 'twelvechars0';
    expect(value).toHaveLength(12);
    expect(parse({ SEED_STAFF_PASSWORD: value }).ok).toBe(true);
  });
});

describe('resolveMediaStorage', () => {
  it('defaults to local on a developer machine and to S3 everywhere else', () => {
    expect(resolveMediaStorage('local', undefined)).toBe('local');
    expect(resolveMediaStorage('staging', undefined)).toBe('s3');
    expect(resolveMediaStorage('production', undefined)).toBe('s3');
  });

  it('takes the setting as given (production refuses local storage in productionProblems)', () => {
    expect(resolveMediaStorage('local', 's3')).toBe('s3');
    expect(resolveMediaStorage('staging', 'local')).toBe('local');
    expect(resolveMediaStorage('production', 'local')).toBe('local');
  });
});

const safe = {
  APP_ENV: 'production' as const,
  CLIENT_ORIGIN: ['https://app.example.com', 'https://staff.example.com'],
  GIT_COMMIT: 'abc1234',
  TRUST_PROXY_HOPS: 2,
  MEDIA_STORAGE: 's3' as const,
  PAYMENT_PROVIDER: 'none' as const,
  ADMIN_MFA_REQUIRED: true,
};

describe('productionProblems', () => {
  it('passes a production environment that has all three', () => {
    expect(productionProblems(safe)).toEqual([]);
  });

  it('refuses a plain-http CLIENT_ORIGIN', () => {
    expect(productionProblems({ ...safe, CLIENT_ORIGIN: ['http://app.example.com'] })).toEqual([
      expect.stringContaining('CLIENT_ORIGIN'),
    ]);
  });

  it('refuses a list where one host is plain http', () => {
    const origins = ['https://app.example.com', 'http://staff.example.com'];
    expect(productionProblems({ ...safe, CLIENT_ORIGIN: origins })).toEqual([
      expect.stringContaining('CLIENT_ORIGIN'),
    ]);
  });

  it('refuses a missing GIT_COMMIT (the schema default)', () => {
    expect(productionProblems({ ...safe, GIT_COMMIT: 'unknown' })).toEqual([
      expect.stringContaining('GIT_COMMIT'),
    ]);
  });

  it('refuses TRUST_PROXY_HOPS of 0', () => {
    expect(productionProblems({ ...safe, TRUST_PROXY_HOPS: 0 })).toEqual([
      expect.stringContaining('TRUST_PROXY_HOPS'),
    ]);
  });

  it('refuses local photo storage (refused here, not by the schema, so the seed still loads env.ts)', () => {
    expect(productionProblems({ ...safe, MEDIA_STORAGE: 'local' })).toEqual([
      expect.stringContaining('MEDIA_STORAGE'),
    ]);
  });

  it('refuses admin MFA turned off (a leaked password alone would open the admin routes)', () => {
    expect(productionProblems({ ...safe, ADMIN_MFA_REQUIRED: false })).toEqual([
      expect.stringContaining('ADMIN_MFA_REQUIRED'),
    ]);
  });

  it('refuses the fake payment provider (it marks orders paid with no money)', () => {
    expect(productionProblems({ ...safe, PAYMENT_PROVIDER: 'fake' })).toEqual([
      expect.stringContaining('PAYMENT_PROVIDER'),
    ]);
  });

  it('leaves staging and local alone (a local stack against staging uses localhost)', () => {
    const loose = {
      CLIENT_ORIGIN: ['http://localhost:5173'],
      GIT_COMMIT: 'unknown',
      TRUST_PROXY_HOPS: 0,
      MEDIA_STORAGE: 'local' as const,
      PAYMENT_PROVIDER: 'fake' as const,
      ADMIN_MFA_REQUIRED: false,
    };
    expect(productionProblems({ ...loose, APP_ENV: 'staging' })).toEqual([]);
    expect(productionProblems({ ...loose, APP_ENV: 'local' })).toEqual([]);
  });
});

// What needs a process of its own: the module-level load exiting, and the entry points refusing to start.
const tsx = (code: string, env: Record<string, string>, timeout = 30_000) =>
  spawnSync('pnpm', ['exec', 'tsx', '-e', code], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout,
  });

describe('importing env.ts', () => {
  it('with a bad env exits non-zero with the message', () => {
    const result = tsx("import('./src/utils/env.ts').then(() => console.log('OK'))", {
      LOG_LEVEL: 'info',
      APP_ENV: 'dev',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid environment configuration');
    expect(result.stderr).toContain('APP_ENV must be one of local, staging, production.');
  });
});

// The refusal must happen in the processes, before anything listens; env.ts itself stays importable (the seed).
describe('a production process with an unsafe environment', () => {
  const unsafe = {
    APP_ENV: 'production',
    CLIENT_ORIGIN: 'http://localhost:5173',
    GIT_COMMIT: '',
    TRUST_PROXY_HOPS: '0',
    MEDIA_STORAGE: 'local',
    PORT: '18000',
    WORKER_HEALTH_PORT: '18001',
  };

  it.each(['server', 'worker'])('%s exits 1 naming every problem', (entry) => {
    const result = tsx(`import('./src/${entry}.ts')`, unsafe, 20_000);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to start in production');
    for (const name of ['CLIENT_ORIGIN', 'GIT_COMMIT', 'TRUST_PROXY_HOPS', 'MEDIA_STORAGE'])
      expect(result.stderr).toContain(name);
  });

  it('still lets env.ts load, so `pnpm run seed --production` works from a laptop', () => {
    const result = tsx(
      "import('./src/utils/env.ts').then(({ env }) => process.stdout.write(env.APP_ENV))",
      unsafe,
      20_000,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('production');
  });

  it('refuses to start an API set to keep photos on local disk', () => {
    const result = tsx("import('./src/server.ts')", {
      APP_ENV: 'production',
      MEDIA_STORAGE: 'local',
      PORT: '18002',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MEDIA_STORAGE=local is for development');
  });
});
