// SEED_*_PASSWORD is validated by env.ts at import time, so its bounds can only be exercised in a fresh process.
// The message must name the failing var and never echo the value back (it is a password).
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const CWD = process.cwd();

function importEnv(seedStaffPassword: string): { status: number; output: string } {
  const childEnv = { ...process.env, LOG_LEVEL: 'info', SEED_STAFF_PASSWORD: seedStaffPassword };
  try {
    const output = execFileSync(
      'pnpm',
      ['exec', 'tsx', '-e', "import('./src/utils/env.ts').then(() => console.log('OK'))"],
      { cwd: CWD, env: childEnv, encoding: 'utf8', timeout: 15_000 },
    );
    return { status: 0, output };
  } catch (err) {
    const e = err as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, output: e.stdout + e.stderr };
  }
}

describe('env.ts SEED_STAFF_PASSWORD bound', () => {
  it('rejects an 11-character value, naming the var but never the value', () => {
    const value = 'elevenchar0';
    expect(value).toHaveLength(11);
    const { status, output } = importEnv(value);
    expect(status).not.toBe(0);
    expect(output).toContain('SEED_STAFF_PASSWORD');
    expect(output).toContain('at least 12 characters');
    expect(output).not.toContain(value);
  });

  it('accepts a 12-character value', () => {
    const value = 'twelvechars0';
    expect(value).toHaveLength(12);
    const { status, output } = importEnv(value);
    expect(status).toBe(0);
    expect(output).toContain('OK');
  });
});
