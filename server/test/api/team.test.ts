// Local only: a store's team (P2.2): who may list, invite and remove whom, and every way an invite can fail to be
// accepted (each the same 404), with the audit row and the domain event each change leaves.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  testAuthMatrix,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
let storeId = '';
let brandId = '';
let owner: TestUser;
let manager: TestUser;
let staff: TestUser;
let admin: TestUser;
const users: TestUser[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const invite = (body: object, user: TestUser = owner) =>
  api().post(`/api/stores/${storeId}/invites`).set(auth(user)).send(body);
const members = (user: TestUser = owner) =>
  api().get(`/api/stores/${storeId}/members`).set(auth(user));
const membershipOf = async (user: TestUser) =>
  (
    await supabaseAdmin
      .from('store_memberships')
      .select('id, role')
      .eq('store_id', storeId)
      .eq('user_id', user.id)
  ).data ?? [];

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Team', slug: `team-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Team store',
      slug: `team-${tag}`,
      brand_id: brandId,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'A store for team.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  owner = await createBrandOwner(brandId);
  manager = await createStoreMember(storeId, 'MANAGER');
  staff = await createStoreMember(storeId, 'STAFF');
  admin = await createTestUser('ADMIN');
  users.push(owner, manager, staff, admin);
}, 60_000);

afterAll(() => deleteTestStores([storeId], [brandId], users));

const sampleId = randomUUID();
testAuthMatrix('GET /api/stores/:storeId/members', (http) =>
  http.get(`/api/stores/${sampleId}/members`),
);
testAuthMatrix('POST /api/stores/:storeId/invites', (http) =>
  http.post(`/api/stores/${sampleId}/invites`).send({ email: 'a@b.co', role: 'STAFF' }),
);
testAuthMatrix('DELETE /api/stores/:storeId/invites/:inviteId', (http) =>
  http.delete(`/api/stores/${sampleId}/invites/${sampleId}`),
);
testAuthMatrix('DELETE /api/stores/:storeId/members/:membershipId', (http) =>
  http.delete(`/api/stores/${sampleId}/members/${sampleId}`),
);

const isolationEmail = () => `iso-${randomUUID()}@example.test`;
testStoreIsolation(
  'GET /api/stores/:storeId/members',
  (http, id) => http.get(`/api/stores/${id}/members`),
  undefined,
  'MANAGER',
);
testStoreIsolation(
  'POST /api/stores/:storeId/invites',
  (http, id) =>
    http.post(`/api/stores/${id}/invites`).send({ email: isolationEmail(), role: 'STAFF' }),
  undefined,
  'MANAGER',
);
testStoreIsolation(
  'DELETE /api/stores/:storeId/invites/:inviteId',
  (http, id, inviteId) => http.delete(`/api/stores/${id}/invites/${inviteId}`),
  async (id) => {
    const { data } = await supabaseAdmin
      .from('store_invites')
      .insert({
        store_id: id,
        role: 'STAFF',
        email: isolationEmail(),
        token_hash: randomUUID(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()
      .throwOnError();
    return data.id;
  },
  'MANAGER',
);
testStoreIsolation(
  'DELETE /api/stores/:storeId/members/:membershipId',
  (http, id, membershipId) => http.delete(`/api/stores/${id}/members/${membershipId}`),
  async (id) => {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', 'staff@campuscafe.local')
      .single()
      .throwOnError();
    const { data } = await supabaseAdmin
      .from('store_memberships')
      .insert({ store_id: id, user_id: profile.id, role: 'STAFF' })
      .select('id')
      .single()
      .throwOnError();
    return data.id;
  },
  'MANAGER',
);

describe('the team list', () => {
  it('shows members with name, email and role, and open invites; staff may not see it', async () => {
    const newcomer = `list-${tag}@example.test`;
    await invite({ email: newcomer, role: 'STAFF' });
    const res = await members(manager);
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: staff.id, email: staff.email, role: 'STAFF' }),
        expect.objectContaining({ userId: manager.id, role: 'MANAGER', name: 'Test User' }),
      ]),
    );
    expect(res.body.invites).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: newcomer, role: 'STAFF' })]),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    expect((await members(staff)).status).toBe(403);
    expect((await members(admin)).status).toBe(200);
  });
});

describe('inviting', () => {
  it('returns the token once and stores only its hash, with an audit row naming the actor', async () => {
    const res = await invite({ email: `  Hash-${tag}@Example.TEST `, role: 'STAFF' }, manager);
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.invite.email).toBe(`hash-${tag}@example.test`);
    const { data: row } = await supabaseAdmin
      .from('store_invites')
      .select('token_hash, created_by')
      .eq('id', res.body.invite.id)
      .single()
      .throwOnError();
    expect(row.token_hash).toBe(createHash('sha256').update(res.body.token).digest('hex'));
    expect(row.created_by).toBe(manager.id);
    const { data: audit } = await supabaseAdmin
      .from('audit_log')
      .select('action, actor_id, actor_role, changes')
      .eq('entity_type', 'invite')
      .eq('entity_id', res.body.invite.id);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'invite.changed',
        actor_id: manager.id,
        actor_role: 'MANAGER',
      }),
    ]);
    expect(JSON.stringify(audit)).not.toContain(row.token_hash);
  });

  it('a manager cannot invite a manager (403); the owner and an admin can', async () => {
    const res = await invite({ email: `m1-${tag}@example.test`, role: 'MANAGER' }, manager);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await invite({ email: `m1-${tag}@example.test`, role: 'MANAGER' })).status).toBe(201);
    expect((await invite({ email: `m2-${tag}@example.test`, role: 'MANAGER' }, admin)).status).toBe(
      201,
    );
  });

  it('an existing member or an open invite → 409 MEMBERSHIP_EXISTS; an expired one is replaced', async () => {
    const asMember = await invite({ email: staff.email, role: 'STAFF' });
    expect(asMember.status).toBe(409);
    expect(asMember.body.error.code).toBe('MEMBERSHIP_EXISTS');
    const email = `twice-${tag}@example.test`;
    const first = await invite({ email, role: 'STAFF' });
    expect((await invite({ email, role: 'STAFF' })).body.error.code).toBe('MEMBERSHIP_EXISTS');
    await supabaseAdmin
      .from('store_invites')
      .update({
        created_at: new Date(Date.now() - 9 * 86_400_000).toISOString(),
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      })
      .eq('id', first.body.invite.id)
      .throwOnError();
    expect((await invite({ email, role: 'STAFF' })).status).toBe(201);
  });

  it.each([
    [{ email: 'not-an-email', role: 'STAFF' }],
    [{ email: `${'a'.repeat(320)}@x.co`, role: 'STAFF' }],
    [{ email: 'a@b.co', role: 'OWNER' }],
    [{ email: 'a@b.co' }],
  ])('%j → 400', async (body) => {
    expect((await invite(body)).status).toBe(400);
  });
});

describe('revoking and removing', () => {
  it('a manager revokes a staff invite but not a manager one; revoking twice is a no-op', async () => {
    const staffInvite = await invite({ email: `rv-s-${tag}@example.test`, role: 'STAFF' });
    const managerInvite = await invite({ email: `rv-m-${tag}@example.test`, role: 'MANAGER' });
    const revoke = (id: string, user: TestUser) =>
      api().delete(`/api/stores/${storeId}/invites/${id}`).set(auth(user));
    expect((await revoke(managerInvite.body.invite.id, manager)).status).toBe(403);
    expect((await revoke(staffInvite.body.invite.id, manager)).status).toBe(204);
    expect((await revoke(staffInvite.body.invite.id, manager)).status).toBe(204);
    expect((await revoke(randomUUID(), manager)).status).toBe(404);
    expect((await revoke('not-a-uuid', manager)).status).toBe(404);
  });

  it('removal takes effect on the next request, and is audited with the actor', async () => {
    const leaving = await createStoreMember(storeId, 'STAFF');
    users.push(leaving);
    const board = () => api().get(`/api/stores/${storeId}/orders`).set(auth(leaving));
    expect((await board()).status).toBe(200);
    const [membership] = await membershipOf(leaving);
    const res = await api()
      .delete(`/api/stores/${storeId}/members/${membership?.id}`)
      .set(auth(manager));
    expect(res.status).toBe(204);
    expect((await board()).status).toBe(403);
    const { data: audit } = await supabaseAdmin
      .from('audit_log')
      .select('actor_id, changes')
      .eq('entity_type', 'membership')
      .eq('entity_id', membership?.id ?? '');
    expect(audit).toEqual(
      expect.arrayContaining([expect.objectContaining({ actor_id: manager.id })]),
    );
  });

  it('a manager cannot remove another manager, but may leave; the owner removes a manager', async () => {
    const other = await createStoreMember(storeId, 'MANAGER');
    const leaver = await createStoreMember(storeId, 'MANAGER');
    users.push(other, leaver);
    const remove = async (target: TestUser, by: TestUser) =>
      api()
        .delete(`/api/stores/${storeId}/members/${(await membershipOf(target))[0]?.id}`)
        .set(auth(by));
    expect((await remove(other, manager)).status).toBe(403);
    expect((await remove(leaver, leaver)).status).toBe(204);
    expect((await remove(other, owner)).status).toBe(204);
    expect(await membershipOf(other)).toEqual([]);
  });
});
