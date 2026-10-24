import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Role } from '../../src/types/enums';
import { invalidate } from '../../src/utils/cache';
import { env } from '../../src/utils/env';
import { supabaseAdmin } from '../../src/utils/supabase';
import { resolveTestTarget } from './target';
import { api } from './api';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** A real access token, sent as `Authorization: Bearer <token>`. */
  token: string;
}

/** Creates a confirmed user with `role` and signs it in. Pair with `deleteTestUser` in afterAll. */
export async function createTestUser(role: Role = 'CUSTOMER'): Promise<TestUser> {
  const email = `test-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Test User', phone: '9999999999' },
  });
  if (error) throw error;

  // The profile trigger always makes a CUSTOMER.
  if (role !== 'CUSTOMER') {
    await supabaseAdmin.from('profiles').update({ role }).eq('id', data.user.id).throwOnError();
  }

  // A throwaway client so the shared admin client never holds a user session.
  const auth = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await auth.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;

  return { id: data.user.id, email, password, token: session.session.access_token };
}

export async function deleteTestUser(user: TestUser | undefined): Promise<void> {
  if (!user) return;
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id); // cascades to the profile
  if (error) throw error;
}

/** Wipes orders and restores the demo store, menu and accounts (`npm run seed`). Local only. */
export function resetDemoData(): void {
  if (resolveTestTarget() !== 'local') throw new Error('resetDemoData is destructive: local only.');
  execFileSync('npx', ['tsx', 'scripts/seed.ts'], { stdio: 'ignore' });
  // The seed rewrote the menu behind the API's back; drop the in-process read cache (utils/cache.ts).
  invalidate();
}

/**
 * Runs one row-returning SQL statement on the local database as `postgres`, for what the API cannot reach: pgmq,
 * `cron.job`, the catalogs. Local only.
 */
export function localSql<Row>(sql: string): Row[] {
  if (resolveTestTarget() !== 'local')
    throw new Error('localSql reaches past the API: local only.');
  const out = execFileSync(
    'npx',
    ['supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  // A bare array, or `{ rows, boundary, warning }` in some local shells. Anything else throws: an empty fallback let
  // the lockdown test pass in CI without checking anything.
  const parsed = JSON.parse(out) as Row[] | { rows?: Row[] };
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!rows) throw new Error(`localSql: no rows in the CLI's output: ${out.slice(0, 200)}`);
  return rows;
}

/** Deletes an account created through `POST /api/auth/register` (not `createTestUser`), by email. */
export async function deleteAccountByEmail(email: string): Promise<void> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle()
    .throwOnError();
  if (profile) await supabaseAdmin.auth.admin.deleteUser(profile.id); // cascades to the profile
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * A syntactically well-formed JWT (three base64url segments) that local Supabase never signed:
 * passes format checks but fails signature verification against the project's JWKS, so it behaves
 * like a token from another project or an expired/tampered one.
 */
export function foreignJwt(): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    sub: randomUUID(),
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const signature = randomBytes(32).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * The shared 401 `UNAUTHORIZED` matrix (check 1) for one protected route: no header, a malformed
 * scheme, a well-formed-but-unsigned JWT, and a valid token whose user was deleted.
 */
export function testAuthMatrix(
  routeLabel: string,
  makeRequest: (http: ReturnType<typeof api>) => request.Test,
): void {
  describe(`${routeLabel} — auth`, () => {
    it.each([
      ['no Authorization header', undefined],
      ['a malformed scheme ("Token x")', 'Token x'],
      ['"Bearer" with nothing after it', 'Bearer'],
      ['"Bearer garbage"', 'Bearer garbage'],
    ])('%s → 401 UNAUTHORIZED', async (_label, header) => {
      const req = makeRequest(api());
      const res = await (header !== undefined ? req.set('Authorization', header) : req);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    });

    it('a well-formed JWT local Supabase did not sign → 401 UNAUTHORIZED', async () => {
      const res = await makeRequest(api()).set('Authorization', `Bearer ${foreignJwt()}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    });

    it('a valid token whose user was deleted → 401 UNAUTHORIZED', async () => {
      const user = await createTestUser();
      await deleteTestUser(user);
      const res = await makeRequest(api()).set('Authorization', `Bearer ${user.token}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    });
  });
}
