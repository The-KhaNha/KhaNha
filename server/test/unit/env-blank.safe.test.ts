// env.ts is read at import time, so a blank value can only be exercised in a fresh process.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function importEnvWith(overrides: Record<string, string>): Record<string, unknown> {
  const output = execFileSync(
    'npx',
    [
      'tsx',
      '-e',
      "import('./src/utils/env.ts').then(({ env }) => process.stdout.write(JSON.stringify(env)))",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...overrides },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  return JSON.parse(output) as Record<string, unknown>;
}

describe('env.ts blank values', () => {
  it('treats a blank number as unset, so a rate limit keeps its default instead of turning off', () => {
    const env = importEnvWith({
      RATE_LIMIT_IP_MAX: '',
      RATE_LIMIT_WRITE_MAX: ' ',
      PUBLIC_READ_TTL_MS: '',
    });
    expect(env.RATE_LIMIT_IP_MAX).toBe(600);
    expect(env.RATE_LIMIT_WRITE_MAX).toBe(30);
    expect(env.PUBLIC_READ_TTL_MS).toBe(10_000);
  });

  it('still honours an explicit 0', () => {
    expect(importEnvWith({ RATE_LIMIT_IP_MAX: '0' }).RATE_LIMIT_IP_MAX).toBe(0);
  });
});
