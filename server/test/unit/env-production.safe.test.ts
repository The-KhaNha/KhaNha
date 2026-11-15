import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { productionProblems } from '../../src/utils/env';

const safe = {
  APP_ENV: 'production' as const,
  CLIENT_ORIGIN: 'https://app.example.com',
  GIT_COMMIT: 'abc1234',
  TRUST_PROXY_HOPS: 2,
};

describe('productionProblems', () => {
  it('passes a production environment that has all three', () => {
    expect(productionProblems(safe)).toEqual([]);
  });

  it('refuses a plain-http CLIENT_ORIGIN', () => {
    expect(productionProblems({ ...safe, CLIENT_ORIGIN: 'http://app.example.com' })).toEqual([
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

  it('leaves staging and local alone (a local stack against staging uses localhost)', () => {
    const loose = {
      CLIENT_ORIGIN: 'http://localhost:5173',
      GIT_COMMIT: 'unknown',
      TRUST_PROXY_HOPS: 0,
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
    for (const name of ['CLIENT_ORIGIN', 'GIT_COMMIT', 'TRUST_PROXY_HOPS'])
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
