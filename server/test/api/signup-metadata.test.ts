import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/schemas/limits';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { throwawayClient } from '../setup/helpers';

// An account can be made without POST /api/auth/register (a direct Auth signup with the bundled publishable key, the
// dashboard), so its metadata never met the API's zod rules. handle_new_user is the one door every account passes:
// whatever the metadata holds, the profile it writes keeps the API's bounds, and so does every order's customer name.

const created: string[] = [];

async function accountWith(metadata: Record<string, unknown>) {
  const email = `meta-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw error;
  created.push(data.user.id);
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name, phone')
    .eq('id', data.user.id)
    .single()
    .throwOnError();
  return { id: data.user.id, email, password, profile };
}

afterAll(async () => {
  // Orders hold their customer (no cascade), so they go first; a failed delete must fail the run, not leak rows.
  if (created.length)
    await supabaseAdmin.from('orders').delete().in('user_id', created).throwOnError();
  for (const id of created) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
});

describe('profiles made from Auth metadata keep the API bounds', () => {
  it('cuts a long name to nameMax and drops a phone that is not one', async () => {
    const { profile } = await accountWith({ name: 'N'.repeat(9000), phone: 'javascript:alert(1)' });
    expect(profile.name).toBe('N'.repeat(LIMITS.nameMax));
    expect(profile.phone).toBeNull();
  });

  it('counts UTF-16 units, as the API does, and never cuts a surrogate pair in half', async () => {
    const { profile } = await accountWith({ name: 'a' + '\u{1F600}'.repeat(59) });
    expect(profile.name).toBe('a' + '\u{1F600}'.repeat(29));
    expect(profile.name.length).toBeLessThanOrEqual(LIMITS.nameMax);
  });

  it('falls back to the email local part for a blank or too-short name', async () => {
    for (const name of ['G', '   ', '']) {
      const { email, profile } = await accountWith({ name });
      expect(profile.name).toBe(email.split('@')[0]);
    }
  });

  it('stores a valid phone normalised, as the API does', async () => {
    const { profile } = await accountWith({ name: 'Asha Rao', phone: '+91 98765-43210' });
    expect(profile.name).toBe('Asha Rao');
    expect(profile.phone).toBe('+919876543210');
  });

  it('refuses a direct write past the bounds (any path, not only the trigger)', async () => {
    const { id } = await accountWith({ name: 'Asha Rao' });
    const { error: name } = await supabaseAdmin
      .from('profiles')
      .update({ name: 'N'.repeat(LIMITS.nameMax + 1) })
      .eq('id', id);
    expect(name?.code).toBe('23514');
    const { error: phone } = await supabaseAdmin
      .from('profiles')
      .update({ phone: 'javascript:alert(1)' })
      .eq('id', id);
    expect(phone?.code).toBe('23514');
  });

  it("an order's customer name is never longer than nameMax", async () => {
    const account = await accountWith({ name: 'N'.repeat(9000) });
    const { data: session, error } = await throwawayClient().auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });
    if (error) throw error;
    const { data: item } = await supabaseAdmin
      .from('menu_items')
      .select('id')
      .is('stock_quantity', null)
      .eq('is_available', true)
      .limit(1)
      .single()
      .throwOnError();

    const res = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${session.session.access_token}`)
      .send({ items: [{ menuItemId: item.id, quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.order.customerName).toHaveLength(LIMITS.nameMax);
  });
});

describe('direct sign-up', () => {
  it('is closed: accounts are made only through the API (local config.toml)', async () => {
    const { data, error } = await throwawayClient().auth.signUp({
      email: `direct-${randomUUID()}@example.test`,
      password: `pw-${randomUUID()}`,
    });
    if (data.user) created.push(data.user.id);
    expect(error?.message).toMatch(/signups? not allowed/i);
  });
});
