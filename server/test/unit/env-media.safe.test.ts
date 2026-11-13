import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolveMediaStorage } from '../../src/utils/env';

describe('resolveMediaStorage', () => {
  it('defaults to local on a developer machine and to S3 everywhere else', () => {
    expect(resolveMediaStorage('local', undefined)).toBe('local');
    expect(resolveMediaStorage('staging', undefined)).toBe('s3');
    expect(resolveMediaStorage('production', undefined)).toBe('s3');
  });

  it('takes the setting, but refuses local storage in production (the API then refuses to start)', () => {
    expect(resolveMediaStorage('local', 's3')).toBe('s3');
    expect(resolveMediaStorage('staging', 'local')).toBe('local');
    expect(resolveMediaStorage('production', 'local')).toBeNull();
  });
});

describe('the env loader', () => {
  it('stops the process when production is set to keep photos on local disk', () => {
    const run = spawnSync('pnpm', ['exec', 'tsx', '-e', "import('./src/utils/env.ts')"], {
      env: { ...process.env, APP_ENV: 'production', MEDIA_STORAGE: 'local' },
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('MEDIA_STORAGE=local is for development');
  }, 30_000);
});
