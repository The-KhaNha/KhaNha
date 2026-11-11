// scripts/seed.ts refuses to seed staging unless all three SEED_*_PASSWORD env vars are set, checked before
// anything is wiped. Verified in an isolated child process with a fake, unreachable SUPABASE_URL: the guard must
// fire from the missing env vars alone, never from a real network call, so this never touches any real project
// (local or staging).
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const CWD = process.cwd();

function runSeed(env: Record<string, string>): { status: number; output: string } {
  const childEnv = { ...process.env };
  delete childEnv.SEED_STAFF_PASSWORD;
  delete childEnv.SEED_ADMIN_PASSWORD;
  delete childEnv.SEED_CUSTOMER_PASSWORD;
  childEnv.LOG_LEVEL = 'info'; // the test runner sets LOG_LEVEL=silent; the guard's failure is logged at error
  Object.assign(childEnv, env);

  try {
    const output = execFileSync('pnpm', ['exec', 'tsx', 'scripts/seed.ts'], {
      cwd: CWD,
      env: childEnv,
      encoding: 'utf8',
      timeout: 15_000,
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, output: e.stdout + e.stderr };
  }
}

describe('scripts/seed.ts staging guard', () => {
  it('exits non-zero naming every missing SEED_*_PASSWORD, without reaching the database', () => {
    const { status, output } = runSeed({
      APP_ENV: 'staging',
      SUPABASE_URL: 'https://fake-project.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_fake0000000000000000000000',
    });

    expect(status).not.toBe(0);
    expect(output).toContain('SEED_STAFF_PASSWORD');
    expect(output).toContain('SEED_ADMIN_PASSWORD');
    expect(output).toContain('SEED_CUSTOMER_PASSWORD');
    // A real DB attempt against an unreachable host would surface a fetch/network error instead.
    expect(output).not.toMatch(/ENOTFOUND|ECONNREFUSED|fetch failed/);
  });

  it('proceeds past the guard once all three are set (fails later, on the unreachable host, not on the guard)', () => {
    const { status, output } = runSeed({
      APP_ENV: 'staging',
      SUPABASE_URL: 'https://fake-project.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_fake0000000000000000000000',
      SEED_STAFF_PASSWORD: 'staffpassword12',
      SEED_ADMIN_PASSWORD: 'adminpassword12',
      SEED_CUSTOMER_PASSWORD: 'customerpassword12',
    });

    expect(status).not.toBe(0);
    expect(output).not.toContain('Set SEED_STAFF_PASSWORD');
  });
});
