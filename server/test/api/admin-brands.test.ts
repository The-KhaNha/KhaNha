// Local only: restaurant onboarding for platform admins (P7.4a PR 01): brands, their templates and owner invites,
// who may call the routes, and the audit row and domain event each change leaves.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  oldestStoreId,
  testAuthMatrix,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
let admin: TestUser;
const users: TestUser[] = [];
const brandIds: string[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const create = (body: object, user: TestUser = admin) =>
  api().post('/api/admin/brands').set(auth(user)).send(body);
const invite = (brandId: string, email: string, user: TestUser = admin) =>
  api().post(`/api/admin/brands/${brandId}/invites`).set(auth(user)).send({ email });
const revoke = (brandId: string, inviteId: string, user: TestUser = admin) =>
  api().delete(`/api/admin/brands/${brandId}/invites/${inviteId}`).set(auth(user));
const list = (user: TestUser = admin) => api().get('/api/admin/brands').set(auth(user));

/** A brand made through the API, remembered for clean-up. */
async function newBrand(name = `Onboard ${tag} ${brandIds.length}`) {
  const res = await create({ name, slug: `onboard-${tag}-${brandIds.length}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  brandIds.push(res.body.brand.id);
  return res.body.brand as { id: string; slug: string };
}
const openInvites = async (brandId: string) =>
  (
    await supabaseAdmin
      .from('brand_invites')
      .select('id, email, token_hash')
      .eq('brand_id', brandId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .throwOnError()
  ).data;

beforeAll(async () => {
  admin = await createTestUser('ADMIN');
  users.push(admin);
}, 60_000);

afterAll(async () => {
  if (brandIds.length === 0) return deleteTestStores([], [], users);
  // brand.created has no store, so deleteTestStores (by store) leaves it.
  await supabaseAdmin.from('domain_events').delete().in('aggregate_id', brandIds).throwOnError();
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .select('id')
    .in('brand_id', brandIds)
    .throwOnError();
  await deleteTestStores(
    stores.map((s) => s.id),
    brandIds,
    users,
  );
});

const sampleId = randomUUID();
testAuthMatrix('GET /api/admin/brands', (http) => http.get('/api/admin/brands'));
testAuthMatrix('POST /api/admin/brands', (http) =>
  http.post('/api/admin/brands').send({ name: 'Nope' }),
);
testAuthMatrix('POST /api/admin/brands/:brandId/invites', (http) =>
  http.post(`/api/admin/brands/${sampleId}/invites`).send({ email: 'a@b.co' }),
);
testAuthMatrix('DELETE /api/admin/brands/:brandId/invites/:inviteId', (http) =>
  http.delete(`/api/admin/brands/${sampleId}/invites/${sampleId}`),
);

describe('who may onboard a restaurant', () => {
  it('only a platform admin: a customer, store staff, a manager and an owner are 403', async () => {
    const storeId = await oldestStoreId();
    const callers = [
      await createTestUser(),
      await createStoreMember(storeId, 'STAFF'),
      await createStoreMember(storeId, 'MANAGER'),
    ];
    const { brand } = (await create({ name: `Owned ${tag}`, slug: `owned-${tag}` })).body;
    brandIds.push(brand.id);
    callers.push(await createBrandOwner(brand.id));
    users.push(...callers);
    for (const caller of callers) {
      expect((await list(caller)).status).toBe(403);
      expect((await create({ name: 'Theirs' }, caller)).status).toBe(403);
      expect((await invite(brand.id, 'x@example.test', caller)).status).toBe(403);
      expect((await revoke(brand.id, sampleId, caller)).status).toBe(403);
    }
  });
});

describe('POST /api/admin/brands', () => {
  it('makes an ACTIVE brand with an empty template, no branches, no owner, and a brand.created event', async () => {
    const res = await create({ name: `Fresh Bites ${tag}` });
    expect(res.status).toBe(201);
    const { brand } = res.body;
    brandIds.push(brand.id);
    expect(brand).toMatchObject({
      name: `Fresh Bites ${tag}`,
      slug: `fresh-bites-${tag}`, // made from the name
      branchCount: 0,
      owner: null,
      invite: null,
    });
    expect(res.headers['cache-control']).toBe('no-store');

    const { data: row } = await supabaseAdmin
      .from('brands')
      .select('status, owner_id, template_store_id')
      .eq('id', brand.id)
      .single()
      .throwOnError();
    expect(row.status).toBe('ACTIVE');
    expect(row.owner_id).toBeNull();
    const { data: stores } = await supabaseAdmin
      .from('stores')
      .select('id, is_template, status')
      .eq('brand_id', brand.id)
      .throwOnError();
    expect(stores).toEqual([{ id: row.template_store_id, is_template: true, status: 'DRAFT' }]);

    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('type, actor')
      .eq('aggregate_id', brand.id)
      .throwOnError();
    expect(events).toEqual([
      { type: 'brand.created', actor: expect.objectContaining({ id: admin.id }) },
    ]);
  });

  it('a taken slug is 409 SLUG_TAKEN on the slug field, and leaves nothing behind', async () => {
    const first = await newBrand();
    const before = await supabaseAdmin.from('stores').select('id', { count: 'exact', head: true });
    const res = await create({ name: 'Another one', slug: first.slug });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SLUG_TAKEN', details: { field: 'slug' } });
    expect(res.body.error.message).toContain('restaurant');
    const after = await supabaseAdmin.from('stores').select('id', { count: 'exact', head: true });
    expect(after.count).toBe(before.count);
  });

  it.each([
    ['a one-character name', { name: 'A' }],
    ['an 81-character name', { name: 'a'.repeat(81) }],
    ['a bad slug', { name: 'Fine name', slug: '-bad-' }],
    ['an unknown field', { name: 'Fine name', ownerId: sampleId }],
    ['a name with no letters for a slug', { name: '!!' }],
  ])('%s is 400 VALIDATION_ERROR', async (_label, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('takes a name at the 80-character bound (the template is named after the brand)', async () => {
    const res = await create({ name: 'b'.repeat(80), slug: `long-${tag}` });
    expect(res.status).toBe(201);
    brandIds.push(res.body.brand.id);
  });
});

describe('owner invites', () => {
  it('returns the token once, stores only its hash, lower-cases the email and audits the row', async () => {
    const brand = await newBrand();
    const res = await invite(brand.id, `Owner.${tag}@Example.TEST`);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.invite).toEqual({
      id: expect.any(String),
      email: `owner.${tag}@example.test`,
      expiresAt: expect.any(String),
      createdAt: expect.any(String),
    });
    // Seven days (INVITE_EXPIRY_DAYS).
    const days =
      (Date.parse(res.body.invite.expiresAt) - Date.parse(res.body.invite.createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);

    const [row] = await openInvites(brand.id);
    expect(row?.token_hash).toBe(createHash('sha256').update(res.body.token).digest('hex'));

    const { data: audit } = await supabaseAdmin
      .from('audit_log')
      .select('action, actor_id, changes')
      .eq('entity_id', res.body.invite.id)
      .throwOnError();
    expect(audit).toEqual([
      expect.objectContaining({ action: 'brand_invite.changed', actor_id: admin.id }),
    ]);
    expect(JSON.stringify(audit[0]?.changes)).not.toContain('token');
  });

  it('a second invite closes the first, so one link is open per brand', async () => {
    const brand = await newBrand();
    const first = await invite(brand.id, `first.${tag}@example.test`);
    const second = await invite(brand.id, `second.${tag}@example.test`);
    expect(second.status).toBe(201);
    expect(await openInvites(brand.id)).toEqual([
      expect.objectContaining({ id: second.body.invite.id }),
    ]);
    const { data: closed } = await supabaseAdmin
      .from('brand_invites')
      .select('revoked_at')
      .eq('id', first.body.invite.id)
      .single()
      .throwOnError();
    expect(closed.revoked_at).not.toBeNull();
  });

  it('three admins inviting at once all get a link, and exactly one stays open (the brand row is locked)', async () => {
    const brand = await newBrand();
    const results = await Promise.all(
      [1, 2, 3].map((n) => invite(brand.id, `race${n}.${tag}@example.test`)),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await openInvites(brand.id)).toHaveLength(1);
  });

  it('a brand that has its owner is 409 BRAND_HAS_OWNER: no invite replaces an owner', async () => {
    const brand = await newBrand();
    users.push(await createBrandOwner(brand.id));
    const res = await invite(brand.id, `late.${tag}@example.test`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRAND_HAS_OWNER');
    expect(await openInvites(brand.id)).toEqual([]);
  });

  it.each([
    ['an unknown brand', randomUUID()],
    ['an id that is no uuid', 'not-a-uuid'],
  ])('%s is 404', async (_label, id) => {
    const res = await invite(id, `x.${tag}@example.test`);
    expect(res.status).toBe(404);
  });

  it('a bad email is 400', async () => {
    const brand = await newBrand();
    expect((await invite(brand.id, 'not-an-email')).status).toBe(400);
  });

  it('revoking is 204 and a repeat is 204; another brand’s invite is 404', async () => {
    const brand = await newBrand();
    const other = await newBrand();
    const { body } = await invite(brand.id, `revoke.${tag}@example.test`);
    expect((await revoke(other.id, body.invite.id)).status).toBe(404);
    expect((await revoke(brand.id, body.invite.id)).status).toBe(204);
    expect((await revoke(brand.id, body.invite.id)).status).toBe(204);
    expect(await openInvites(brand.id)).toEqual([]);
    expect((await revoke(brand.id, 'not-a-uuid')).status).toBe(404);
  });
});

describe('GET /api/admin/brands', () => {
  it('lists each brand with its owner or its open invite and branch count, never cached', async () => {
    const owned = await newBrand(`List owned ${tag}`);
    const owner = await createBrandOwner(owned.id);
    users.push(owner);
    const invited = await newBrand(`List invited ${tag}`);
    const { body: sent } = await invite(invited.id, `listed.${tag}@example.test`);

    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const byId = new Map((res.body.brands as { id: string }[]).map((b) => [b.id, b] as const));
    expect(byId.get(owned.id)).toMatchObject({
      branchCount: 0,
      owner: { id: owner.id, email: expect.any(String) },
      invite: null,
    });
    expect(byId.get(invited.id)).toMatchObject({ owner: null, invite: sent.invite });
    // A seeded brand with branches counts them, the template not included.
    const seeded = (res.body.brands as { slug: string; branchCount: number }[]).find(
      (b) => b.slug === 'campus-cafe',
    );
    if (seeded) expect(seeded.branchCount).toBeGreaterThan(0);
  });
});
