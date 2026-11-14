import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role, StoreRole } from '../../src/types/enums';
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

  // The profile trigger makes a CUSTOMER and STAFF is a membership role only, so 'STAFF' means: staff of the oldest
  // store (the profile stays CUSTOMER).
  if (role === 'ADMIN') {
    await supabaseAdmin.from('profiles').update({ role }).eq('id', data.user.id).throwOnError();
  }
  if (role === 'STAFF') {
    await supabaseAdmin
      .from('store_memberships')
      .insert({ user_id: data.user.id, store_id: await oldestStoreId(), role: 'STAFF' })
      .throwOnError();
  }

  const { data: session, error: signInError } = await throwawayClient().auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;

  return { id: data.user.id, email, password, token: session.session.access_token };
}

/** A new account that works at `storeId` as `role`; its profile stays CUSTOMER (store roles are memberships). */
export async function createStoreMember(storeId: string, role: StoreRole): Promise<TestUser> {
  const user = await createTestUser();
  await supabaseAdmin
    .from('store_memberships')
    .insert({ user_id: user.id, store_id: storeId, role })
    .throwOnError();
  return user;
}

/** A new account that owns `brandId`, replacing its owner: use it on a brand the test created. */
export async function createBrandOwner(brandId: string): Promise<TestUser> {
  const user = await createTestUser();
  await supabaseAdmin.from('brands').update({ owner_id: user.id }).eq('id', brandId).throwOnError();
  return user;
}

/** A client that never holds a session past its call, so the shared admin client stays signed out. */
export function throwawayClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Signs `user` in once more: a new auth session (its own `session_id` claim) and refresh token. */
export async function signInAgain(
  user: TestUser,
): Promise<{ token: string; refresh: string; sessionId: string }> {
  const { data, error } = await throwawayClient().auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw error;
  const token = data.session.access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
    session_id: string;
  };
  return { token, refresh: data.session.refresh_token, sessionId: claims.session_id };
}

export async function deleteTestUser(user: TestUser | undefined): Promise<void> {
  if (!user) return;
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id); // cascades to the profile
  if (error) throw error;
}

/** Wipes orders and restores the demo store, menu and accounts (`pnpm run seed`). Local only. */
export function resetDemoData(): void {
  if (resolveTestTarget() !== 'local') throw new Error('resetDemoData is destructive: local only.');
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/seed.ts'], { stdio: 'ignore' });
  // The seed rewrote the menu behind the API's back; drop the in-process read cache (utils/cache.ts).
  invalidate();
}

/**
 * The oldest store: where `createTestUser('STAFF')` works and what tests order from by default. A test that orders
 * "an item" must pick it from this store, or the API refuses it as another store's.
 */
export async function oldestStoreId(): Promise<string> {
  const { data } = await supabaseAdmin
    .from('stores')
    .select('id')
    // A brand template (P3.1) is never orderable, so it is never "the" store.
    .eq('is_template', false)
    .order('created_at')
    .order('id')
    .limit(1)
    .single()
    .throwOnError();
  return data.id;
}

/**
 * Runs one row-returning SQL statement on the local database as `postgres`, for what the API cannot reach: pgmq,
 * `cron.job`, the catalogs. Local only.
 */
export function localSql<Row>(sql: string): Row[] {
  if (resolveTestTarget() !== 'local')
    throw new Error('localSql reaches past the API: local only.');
  const out = execFileSync(
    'pnpm',
    ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
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

/**
 * Removes what a test made on its own stores: their events and orders, the users (with their orders at any store),
 * the stores' menus, then the stores and brands. Nothing cascades from a store to its orders or events.
 */
export async function deleteTestStores(
  storeIds: string[],
  brandIds: string[],
  users: TestUser[],
): Promise<void> {
  await supabaseAdmin.from('domain_events').delete().in('store_id', storeIds).throwOnError();
  await supabaseAdmin.from('orders').delete().in('store_id', storeIds).throwOnError();
  const userIds = users.map((user) => user.id);
  await supabaseAdmin.from('orders').delete().in('user_id', userIds).throwOnError();
  await supabaseAdmin.from('stock_movements').delete().in('store_id', storeIds).throwOnError();
  await supabaseAdmin.from('media_uploads').delete().in('store_id', storeIds).throwOnError();
  // After the orders and movements: both point at the items. Nothing cascades from a store to its menu.
  await supabaseAdmin.from('menu_items').delete().in('store_id', storeIds).throwOnError();
  // A branch's groups are copied with its items (copy_template_modifiers); options and links cascade.
  await supabaseAdmin.from('modifier_groups').delete().in('store_id', storeIds).throwOnError();
  await Promise.all(users.map((user) => deleteTestUser(user)));
  await supabaseAdmin.from('stores').delete().in('id', storeIds).throwOnError();
  await supabaseAdmin.from('brands').delete().in('id', brandIds).throwOnError();
  invalidate();
}

/**
 * The tenant matrix every store route runs (P2.3), on two stores of two brands it makes itself. `send` calls the route
 * for `storeId`, addressing `resourceId`; `resource(storeId)` makes one of the route's resources there (omit it for a
 * route that addresses none, such as a list). Staff of store A on store B's route → 403; A's staff reaching B's
 * resource through A's route → 404; the other brand's owner → 403; a customer → 403; anonymous → 401; and A's staff
 * on A's own resource get through, so the refusals are not vacuous.
 */
export function testStoreIsolation(
  label: string,
  send: (http: ReturnType<typeof api>, storeId: string, resourceId: string) => request.Test,
  resource?: (storeId: string) => Promise<string>,
  // The role of store A's member: STAFF, or MANAGER for a route a staff member may not call.
  memberRole: StoreRole = 'STAFF',
): void {
  describe(`${label} — store isolation`, () => {
    const tag = randomUUID().slice(0, 8);
    const brandIds: string[] = [];
    const users: TestUser[] = [];
    const store = { a: '', b: '' };
    const resourceOf = { a: '', b: '' };
    let staffA: TestUser;
    let ownerB: TestUser;
    let customer: TestUser;

    beforeAll(async () => {
      const { data: brands } = await supabaseAdmin
        .from('brands')
        .insert(
          ['a', 'b'].map((key) => ({
            name: `Iso ${key}`,
            slug: `iso-${key}-${tag}`,
            status: 'ACTIVE' as const,
          })),
        )
        .select('id, slug')
        .throwOnError();
      brandIds.push(...brands.map((brand) => brand.id));
      const { data: stores } = await supabaseAdmin
        .from('stores')
        .insert(
          brands.map((brand) => ({
            name: `Isolation ${brand.slug}`,
            slug: `store-${brand.slug}`,
            brand_id: brand.id,
            status: 'ACTIVE' as const,
            tagline: 'Test',
            description: 'A store for testStoreIsolation',
          })),
        )
        .select('id, slug')
        .throwOnError();
      for (const key of ['a', 'b'] as const) {
        store[key] = stores.find((row) => row.slug === `store-iso-${key}-${tag}`)?.id ?? '';
        resourceOf[key] = resource ? await resource(store[key]) : randomUUID();
      }
      staffA = await createStoreMember(store.a, memberRole);
      ownerB = await createBrandOwner(brandIds[1] ?? '');
      customer = await createTestUser();
      users.push(staffA, ownerB, customer);
    }, 60_000);

    afterAll(() => deleteTestStores(Object.values(store), brandIds, users));

    const call = (who: TestUser | null, storeKey: 'a' | 'b', resourceKey: 'a' | 'b') => {
      const req = send(api(), store[storeKey], resourceOf[resourceKey]);
      return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
    };

    it('anonymous → 401', async () => {
      expect((await call(null, 'a', 'a')).status).toBe(401);
    });
    it.each([
      ['a customer', () => customer],
      ["the other brand's owner", () => ownerB],
    ])('%s → 403', async (_who, who) => {
      const res = await call(who(), 'a', 'a');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
    it("store A's staff on store B's route → 403", async () => {
      expect((await call(staffA, 'b', 'b')).status).toBe(403);
    });
    it.runIf(resource !== undefined)(
      "store A's staff reaching B's resource through A's route → 404",
      async () => {
        const res = await call(staffA, 'a', 'b');
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      },
    );
    it("store A's staff on A's own route get through", async () => {
      expect((await call(staffA, 'a', 'a')).status).toBeLessThan(300);
    });
  });
}

/** `GET` path of the oldest store's menu (the stores routes take an id or a slug). */
export async function menuPath(): Promise<string> {
  return `/api/stores/${await oldestStoreId()}/menu`;
}
