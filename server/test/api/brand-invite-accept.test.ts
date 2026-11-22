// Local only: accepting an owner invite (P7.4a PR 02): the account owns the brand from its next request, can open a
// branch and invite its team; every way an accept can fail is the same 404, an ADMIN's included (D6).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createTestUser,
  deleteTestStores,
  testAuthMatrix,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
let admin: TestUser;
const users: TestUser[] = [];
const brandIds: string[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const accept = (token: string, user: TestUser) =>
  api().post('/api/me/brand-invites/accept').set(auth(user)).send({ token });
const fresh = async (role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') => {
  const user = await createTestUser(role);
  users.push(user);
  return user;
};

/** A brand and an owner invite for `email`, both made by the admin through the API. */
async function brandWithInvite(email: string) {
  const created = await api()
    .post('/api/admin/brands')
    .set(auth(admin))
    .send({ name: `Accept ${tag} ${brandIds.length}`, slug: `accept-${tag}-${brandIds.length}` });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const brandId: string = created.body.brand.id;
  brandIds.push(brandId);
  const sent = await api()
    .post(`/api/admin/brands/${brandId}/invites`)
    .set(auth(admin))
    .send({ email });
  expect(sent.status).toBe(201);
  return { brandId, inviteId: sent.body.invite.id as string, token: sent.body.token as string };
}
const ownerOf = async (brandId: string) =>
  (await supabaseAdmin.from('brands').select('owner_id').eq('id', brandId).single().throwOnError())
    .data.owner_id;

beforeAll(async () => {
  admin = await fresh('ADMIN');
}, 60_000);

afterAll(async () => {
  if (brandIds.length === 0) return deleteTestStores([], [], users);
  const { data: invites } = await supabaseAdmin
    .from('brand_invites')
    .select('id')
    .in('brand_id', brandIds)
    .throwOnError();
  await supabaseAdmin
    .from('domain_events')
    .delete()
    .in('aggregate_id', [...brandIds, ...invites.map((i) => i.id)])
    .throwOnError();
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

testAuthMatrix('POST /api/me/brand-invites/accept', (http) =>
  http.post('/api/me/brand-invites/accept').send({ token: 'x' }),
);

describe('accepting an owner invite', () => {
  it('makes the account the owner: on its next request it lists the brand, opens a branch and invites staff', async () => {
    const owner = await fresh();
    const { brandId, inviteId, token } = await brandWithInvite(owner.email);

    const res = await accept(token, owner);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brand: { id: brandId, name: expect.any(String), slug: expect.any(String) },
    });
    expect(await ownerOf(brandId)).toBe(owner.id);

    const mine = await api().get('/api/brands/mine').set(auth(owner));
    expect(mine.body.brands.map((b: { id: string }) => b.id)).toContain(brandId);
    const branch = await api()
      .post(`/api/brands/${brandId}/stores`)
      .set(auth(owner))
      .send({ name: `First branch ${tag}`, slug: `first-${tag}` });
    expect(branch.status, JSON.stringify(branch.body)).toBe(201);
    const team = await api()
      .post(`/api/stores/${branch.body.store.id}/invites`)
      .set(auth(owner))
      .send({ email: `manager.${tag}@example.test`, role: 'MANAGER' });
    expect(team.status).toBe(201);

    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('type, payload, actor')
      .eq('aggregate_id', inviteId)
      .throwOnError();
    expect(events).toEqual([
      {
        type: 'brand.owner_joined',
        payload: { brandId },
        actor: expect.objectContaining({ id: owner.id }),
      },
    ]);
    const { data: audit } = await supabaseAdmin
      .from('audit_log')
      .select('action, actor_id')
      .eq('entity_id', brandId)
      .eq('action', 'brand.changed')
      .eq('actor_id', owner.id)
      .throwOnError();
    expect(audit).toHaveLength(1);
  });

  it('a repeat by the same account is 200 and changes nothing more; two at once leave one event', async () => {
    const owner = await fresh();
    const { inviteId, token } = await brandWithInvite(owner.email);
    const results = await Promise.all([accept(token, owner), accept(token, owner)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await accept(token, owner)).status).toBe(200);
    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('id')
      .eq('aggregate_id', inviteId)
      .throwOnError();
    expect(events).toHaveLength(1);
  });

  it('an account that owns a brand already ends up owning two (D5)', async () => {
    const owner = await fresh();
    const first = await brandWithInvite(owner.email);
    await accept(first.token, owner);
    const second = await brandWithInvite(owner.email);
    expect((await accept(second.token, owner)).status).toBe(200);
    const mine = await api().get('/api/brands/mine').set(auth(owner));
    expect(mine.body.brands.map((b: { id: string }) => b.id)).toEqual(
      expect.arrayContaining([first.brandId, second.brandId]),
    );
  });
});

describe('every refusal is the same 404, and the brand keeps no owner', () => {
  const expectRefused = async (token: string, user: TestUser, brandId: string) => {
    const res = await accept(token, user);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'That invite is not valid any more.',
    });
    expect(await ownerOf(brandId)).toBeNull();
  };

  it('an unknown token', async () => {
    const user = await fresh();
    const { brandId } = await brandWithInvite(user.email);
    await expectRefused('x'.repeat(43), user, brandId);
  });

  it("another account's invite", async () => {
    const invited = await fresh();
    const other = await fresh();
    const { brandId, token } = await brandWithInvite(invited.email);
    await expectRefused(token, other, brandId);
  });

  it('an expired invite', async () => {
    const user = await fresh();
    const { brandId, inviteId, token } = await brandWithInvite(user.email);
    const past = new Date(Date.now() - 60_000).toISOString();
    await supabaseAdmin
      .from('brand_invites')
      .update({ created_at: new Date(Date.now() - 120_000).toISOString(), expires_at: past })
      .eq('id', inviteId)
      .throwOnError();
    await expectRefused(token, user, brandId);
  });

  it('a revoked invite', async () => {
    const user = await fresh();
    const { brandId, inviteId, token } = await brandWithInvite(user.email);
    await api().delete(`/api/admin/brands/${brandId}/invites/${inviteId}`).set(auth(admin));
    await expectRefused(token, user, brandId);
  });

  it('a brand that has an owner by now: an invite never replaces one (D4)', async () => {
    const user = await fresh();
    const { brandId, token } = await brandWithInvite(user.email);
    const owner = await createBrandOwner(brandId);
    users.push(owner);
    const res = await accept(token, user);
    expect(res.status).toBe(404);
    expect(await ownerOf(brandId)).toBe(owner.id);
  });

  it('an invite another account accepted', async () => {
    const owner = await fresh();
    const { brandId, token } = await brandWithInvite(owner.email);
    expect((await accept(token, owner)).status).toBe(200);
    // Same email cannot be a second account; the accepted invite refuses anyone but its accepter.
    const other = await fresh();
    const res = await accept(token, other);
    expect(res.status).toBe(404);
    expect(await ownerOf(brandId)).toBe(owner.id);
  });

  it('a platform ADMIN, even with an invite for its email made behind the API (D6)', async () => {
    const otherAdmin = await fresh('ADMIN');
    // The API refuses to make this invite (below); the function refuses it anyway.
    const { brandId, inviteId, token } = await brandWithInvite(`stand-in.${tag}@example.test`);
    await supabaseAdmin
      .from('brand_invites')
      .update({ email: otherAdmin.email })
      .eq('id', inviteId)
      .throwOnError();
    await expectRefused(token, otherAdmin, brandId);
  });

  it("the API refuses to invite an admin's email at all: nobody could accept it", async () => {
    const otherAdmin = await fresh('ADMIN');
    const { brandId } = await brandWithInvite(`first.${tag}@example.test`);
    const res = await api()
      .post(`/api/admin/brands/${brandId}/invites`)
      .set(auth(admin))
      .send({ email: otherAdmin.email });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'email' } });
  });

  it('an owner accepting while the admin re-issues the link never deadlocks (both lock the brand first)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const owner = await fresh();
      const { brandId, token } = await brandWithInvite(owner.email);
      const [accepted, reissued] = await Promise.all([
        accept(token, owner),
        api()
          .post(`/api/admin/brands/${brandId}/invites`)
          .set(auth(admin))
          .send({ email: owner.email }),
      ]);
      // Either order is fine (accept first: the re-issue is 409; re-issue first: the old link is 404). Never a 500.
      expect([200, 404]).toContain(accepted.status);
      expect([201, 409]).toContain(reissued.status);
    }
  });
});
