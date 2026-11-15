// Local only: the brands and stores columns (P2 PR 01). Writes a throwaway brand and store, removed afterwards; the
// audit rows they leave are append-only and stay.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser } from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
let brandId: string;
let storeId: string;

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Schema Test', slug: `schema-test-${tag}` })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Schema Test Store',
      slug: `schema-test-store-${tag}`,
      brand_id: brandId,
      tagline: 'Test',
      description: 'A store for stores-schema.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
}, 30_000);

afterAll(async () => {
  await supabaseAdmin.from('stores').delete().eq('id', storeId);
  await supabaseAdmin.from('brands').delete().eq('id', brandId);
});

describe('stores and brands schema', () => {
  it('every store has a brand and a slug (the backfill, then not null)', async () => {
    const { data } = await supabaseAdmin
      .from('stores')
      .select('id, slug, brand_id, brands!stores_brand_id_fkey(id)')
      .throwOnError();
    expect(data.length).toBeGreaterThanOrEqual(3);
    expect(data.filter((s) => !s.slug || !s.brand_id || !s.brands)).toEqual([]);
  });

  it('refuses a duplicate store slug and a duplicate brand slug', async () => {
    const dupStore = await supabaseAdmin.from('stores').insert({
      name: 'Dup',
      slug: `schema-test-store-${tag}`,
      brand_id: brandId,
      tagline: 'x',
      description: 'x',
    });
    expect(dupStore.error?.code).toBe('23505');
    const dupBrand = await supabaseAdmin
      .from('brands')
      .insert({ name: 'Dup', slug: `schema-test-${tag}` });
    expect(dupBrand.error?.code).toBe('23505');
  });

  it.each(['Upper', 'has space', '-lead', 'trail-', 'a'.repeat(61), ''])(
    'refuses the slug %j',
    async (slug) => {
      const store = await supabaseAdmin.from('stores').insert({
        name: 'Bad',
        slug,
        brand_id: brandId,
        tagline: 'x',
        description: 'x',
      });
      expect(store.error?.code).toBe('23514');
      const brand = await supabaseAdmin.from('brands').insert({ name: 'Bad', slug });
      expect(brand.error?.code).toBe('23514');
    },
  );

  it('an update writes one audit row with the actor and the store; the same values write none', async () => {
    const actor = { type: 'USER', id: randomUUID(), role: 'ADMIN' };
    const requestId = `stores-schema-${tag}`;
    const save = (area: string, id: string) =>
      supabaseAdmin
        .from('stores')
        .update({ area })
        .eq('id', storeId)
        .setHeader('x-actor', JSON.stringify({ ...actor, id }))
        .setHeader('x-request-id', requestId)
        .throwOnError();
    await save('North', actor.id);
    await save('North', actor.id);

    const { data } = await supabaseAdmin
      .from('audit_log')
      .select('actor_type, actor_id, actor_role, store_id, action, entity_type, entity_id, changes')
      .eq('request_id', requestId)
      .throwOnError();
    expect(data).toEqual([
      {
        actor_type: 'USER',
        actor_id: actor.id,
        actor_role: 'ADMIN',
        // A store's own row is its store, so the change reaches the store's audit trail.
        store_id: storeId,
        action: 'store.changed',
        entity_type: 'store',
        entity_id: storeId,
        changes: { area: [null, 'North'] },
      },
    ]);
  });

  it('a membership writes one audit row on insert, update and delete, with the store role as actor_role', async () => {
    const member = await createTestUser();
    try {
      const requestId = `memberships-schema-${tag}`;
      const actor = JSON.stringify({
        type: 'USER',
        id: randomUUID(),
        role: 'CUSTOMER',
        storeRole: 'OWNER',
      });
      const { data: row } = await supabaseAdmin
        .from('store_memberships')
        .insert({ user_id: member.id, store_id: storeId, role: 'STAFF' })
        .setHeader('x-actor', actor)
        .setHeader('x-request-id', requestId)
        .select('id')
        .single()
        .throwOnError();
      await supabaseAdmin
        .from('store_memberships')
        .update({ role: 'MANAGER' })
        .eq('id', row.id)
        .setHeader('x-actor', actor)
        .setHeader('x-request-id', requestId)
        .throwOnError();
      await supabaseAdmin
        .from('store_memberships')
        .delete()
        .eq('id', row.id)
        .setHeader('x-actor', actor)
        .setHeader('x-request-id', requestId)
        .throwOnError();
      const { data } = await supabaseAdmin
        .from('audit_log')
        .select('actor_role, store_id, action, entity_type, entity_id, changes')
        .eq('request_id', requestId)
        .order('id')
        .throwOnError();
      const common = {
        actor_role: 'OWNER',
        store_id: storeId,
        action: 'membership.changed',
        entity_type: 'membership',
        entity_id: row.id,
      };
      expect(data).toEqual([
        {
          ...common,
          changes: { user_id: [null, member.id], store_id: [null, storeId], role: [null, 'STAFF'] },
        },
        { ...common, changes: { role: ['STAFF', 'MANAGER'] } },
        {
          ...common,
          changes: {
            user_id: [member.id, null],
            store_id: [storeId, null],
            role: ['MANAGER', null],
          },
        },
      ]);
    } finally {
      await deleteTestUser(member);
    }
  });
});
