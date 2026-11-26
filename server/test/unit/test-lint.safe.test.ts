import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The test-file rules in eslint.config.mjs (WEAK_ERROR_STATUS): a bare 404 or `.expect(4xx)` also passes for a
// deleted route, and a Date.now() duration can go negative when the wall clock steps back.
const eslint = new ESLint({ cwd: join(__dirname, '../..') });

async function flagged(code: string, filePath = 'test/api/example.test.ts'): Promise<number> {
  const [result] = await eslint.lintText(`${code}\n`, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').length;
}

describe('test lint rules', () => {
  it('refuses a bare 404 check and a supertest .expect(4xx)', async () => {
    expect(await flagged('expect(res.status).toBe(404);')).toBe(1);
    expect(await flagged('expect(res.status).toEqual(404);')).toBe(1);
    expect(await flagged("api().get('/api/x').expect(403);")).toBe(1);
  });

  it('refuses a duration on the wall clock', async () => {
    expect(await flagged('const ms = Date.now() - started;')).toBe(1);
    expect(await flagged('const ms = Date.now() - t.start;')).toBe(1);
  });

  it('leaves other statuses, past timestamps, helpers.ts and source alone', async () => {
    expect(await flagged('expect(res.status).toBe(200);')).toBe(0);
    expect(await flagged("api().get('/api/x').expect(200);")).toBe(0);
    expect(await flagged('const past = Date.now() - 48 * HOUR;')).toBe(0);
    expect(await flagged('expect(res.status).toBe(404);', 'test/setup/helpers.ts')).toBe(0);
    expect(await flagged('const ms = Date.now() - started;', 'src/utils/cache.ts')).toBe(0);
  });
});
