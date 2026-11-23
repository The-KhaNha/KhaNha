import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { productionProblems } from '../../src/utils/env';

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
  const run = (code: string) =>
    spawnSync('pnpm', ['exec', 'tsx', '-e', code], {
      cwd: process.cwd(),
      env: { ...process.env, ...unsafe },
      encoding: 'utf8',
      timeout: 20_000,
    });

  it.each(['server', 'worker'])('%s exits 1 naming every problem', (entry) => {
    const result = run(`import('./src/${entry}.ts')`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to start in production');
    for (const name of ['CLIENT_ORIGIN', 'GIT_COMMIT', 'TRUST_PROXY_HOPS', 'MEDIA_STORAGE'])
      expect(result.stderr).toContain(name);
  });

  it('still lets env.ts load, so `pnpm run seed --production` works from a laptop', () => {
    const result = run(
      "import('./src/utils/env.ts').then(({ env }) => process.stdout.write(env.APP_ENV))",
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('production');
  });
});
