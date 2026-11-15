// User-facing wording that zod 4 could silently change: pinned through describeIssue and a fresh env.ts import.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { describeIssue } from '../../src/middleware/validate';
import { registerSchema } from '../../src/schemas/auth.schema';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  updateOrderStatusSchema,
} from '../../src/schemas/order.schema';

function message(schema: z.ZodType, input: unknown, source: 'body' | 'query' = 'body'): string {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return describeIssue(result.error?.issues[0], source);
}

const items = [{ menuItemId: 'a', quantity: 1 }];
const reg = { name: 'Ann', email: 'ann@example.test', password: 'pw123456' };

describe('user-facing validation wording', () => {
  it('names the allowed statuses on an unknown status (body and query)', () => {
    const want = 'Status must be one of PLACED, PREPARING, READY, COLLECTED, CANCELLED.';
    expect(message(updateOrderStatusSchema, { status: 'DONE' })).toBe(want);
    expect(message(listOrdersQuerySchema, { status: 'x' }, 'query')).toBe(want);
  });

  it('keeps the idempotencyKey UUID message', () => {
    expect(message(createOrderSchema, { items, idempotencyKey: 'nope' })).toBe(
      'idempotencyKey must be a UUID.',
    );
  });

  it('keeps the email message, and says "required" for a missing one', () => {
    expect(message(registerSchema, { ...reg, email: 'not-an-email' })).toBe(
      'Please enter a valid email address.',
    );
    expect(message(registerSchema, { name: 'Ann', password: 'pw123456' })).toBe(
      'Email is required.',
    );
  });

  it('missing vs wrong-typed fields', () => {
    expect(message(createOrderSchema, {})).toBe('Items is required.');
    expect(message(createOrderSchema, { items: 'x' })).toBe('Items is invalid.');
    // A missing status is "required", as with zod 3; a wrong one names the allowed statuses (above).
    expect(message(updateOrderStatusSchema, {})).toBe('Status is required.'); // as with zod 3
  });
});

// env.ts validates at import time, so each case needs a fresh process.
function importEnv(overrides: Record<string, string | undefined>): { status: number; out: string } {
  // An empty dotenv file stops dotenv/config refilling the vars a case deletes.
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides, DOTENV_CONFIG_PATH: '/dev/null' };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete env[k];
  try {
    const out = execFileSync(
      'pnpm',
      ['exec', 'tsx', '-e', "import('./src/utils/env.ts').then(() => console.log('OK'))"],
      { cwd: process.cwd(), env, encoding: 'utf8', timeout: 15_000, stdio: 'pipe' },
    );
    return { status: 0, out };
  } catch (err) {
    const e = err as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, out: e.stdout + e.stderr };
  }
}

describe('env.ts messages', () => {
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
  ])('%j fails with its own message', (overrides, expected) => {
    const { status, out } = importEnv({ LOG_LEVEL: 'info', ...overrides });
    expect(status).not.toBe(0);
    expect(out).toContain(expected);
  });

  it('coerces numeric strings and defaults when unset', () => {
    expect(importEnv({ PORT: '9001', PUBLIC_READ_TTL_MS: '0', LOG_LEVEL: 'info' }).status).toBe(0);
    expect(importEnv({ PORT: 'abc', LOG_LEVEL: 'info' }).status).not.toBe(0);
  });
});
