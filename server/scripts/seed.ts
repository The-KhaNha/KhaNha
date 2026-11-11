// Local and staging (`pnpm run seed`): an idempotent demo reset. Wipes all orders, then refreshes the brands, their stores,
// their menus and the test accounts. The store, menu items and test accounts keep their ids across re-seeds, so a
// browser that is already signed in or has a saved cart keeps working.
//
// Production (`pnpm run seed --production`): first-time setup only. Creates the store and menu while production
// has no store yet, and nothing else: no wipes, and no test accounts with well-known passwords.
import { env } from '../src/utils/env';
import { logger } from '../src/utils/logger';
import { supabaseAdmin as db } from '../src/utils/supabase';
import type { Tables } from '../src/types/database';
import { BRANDS, DEMO_ACCOUNTS, type SeedBrand, type SeedMenuItem } from './seed-data';

const ACCOUNTS = DEMO_ACCOUNTS.map(({ localPassword, stagingPassword, ...account }) => ({
  ...account,
  password: env.APP_ENV === 'staging' ? (env[stagingPassword] ?? '') : localPassword,
}));

/** A brand and its stores, found by slug so a re-seed keeps their ids. Returns each store with its menu. */
async function seedBrand(
  brand: SeedBrand,
  ownerIds: Map<string, string>,
): Promise<{ store: Tables<'stores'>; menu: SeedMenuItem[] }[]> {
  const row = {
    name: brand.name,
    slug: brand.slug,
    description: brand.description,
    status: 'ACTIVE' as const,
    owner_id: ownerIds.get(brand.ownerEmail) ?? null,
  };
  const { data: saved } = await db
    .from('brands')
    .upsert(row, { onConflict: 'slug' })
    .select('id')
    .single()
    .throwOnError();

  const stores: { store: Tables<'stores'>; menu: SeedMenuItem[] }[] = [];
  for (const { menu, ...fields } of brand.stores) {
    const { data: store } = await db
      .from('stores')
      .upsert({ ...fields, brand_id: saved.id, status: 'ACTIVE' }, { onConflict: 'slug' })
      .select()
      .single()
      .throwOnError();
    stores.push({ store, menu });
  }
  return stores;
}

async function seedMenu(storeId: string, menu: SeedMenuItem[]): Promise<Tables<'menu_items'>[]> {
  // By name, not the whole table: PostgREST caps a response at 1000 rows, so a large menu would hide seeded items and
  // insert duplicates (server/test/api/menu-cap.test.ts).
  const names = menu.map((item) => item.name);
  const { data: current } = await db
    .from('menu_items')
    .select('id, name')
    .eq('store_id', storeId)
    .in('name', names)
    .throwOnError();
  const idByName = new Map(current.map((item) => [item.name, item.id]));

  const items: Tables<'menu_items'>[] = [];
  for (const [index, item] of menu.entries()) {
    const row = {
      store_id: storeId,
      category: item.category,
      name: item.name,
      description: item.description,
      price_paise: item.pricePaise,
      image_url: item.imageUrl,
      is_popular: item.isPopular ?? false,
      is_available: item.isAvailable ?? true,
      // Explicit null (not undefined) so re-seeding resets stock on items that used to be limited.
      stock_quantity: item.stockQuantity ?? null,
      sort_order: index + 1,
    };
    const id = idByName.get(item.name);
    const { data: saved } = id
      ? await db.from('menu_items').update(row).eq('id', id).select().single().throwOnError()
      : await db.from('menu_items').insert(row).select().single().throwOnError();
    items.push(saved);
  }

  // Everything else in the store goes: items dropped from the list and duplicates of seeded names (safe: orders were
  // wiped first). Filtered by the ids just saved, a short list whatever the menu's size; listing the stale ids instead
  // overflows the request URL on a large menu.
  await db
    .from('menu_items')
    .delete()
    .eq('store_id', storeId)
    .not('id', 'in', `(${items.map((item) => item.id).join(',')})`)
    .throwOnError();
  return items;
}

async function seedAccounts(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const { password, role, ...account } of ACCOUNTS) {
    const { data: existing } = await db
      .from('profiles')
      .select('id')
      .eq('email', account.email)
      .maybeSingle()
      .throwOnError();
    const attributes = {
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { name: account.name, phone: account.phone },
    };
    const { data, error } = existing
      ? await db.auth.admin.updateUserById(existing.id, attributes)
      : await db.auth.admin.createUser(attributes);
    if (error)
      throw new Error(`Could not save the test account ${account.email}: ${error.message}`);

    // The profile trigger only runs on creation, and always makes a CUSTOMER.
    await db
      .from('profiles')
      .update({ name: account.name, phone: account.phone, role })
      .eq('id', data.user.id)
      .throwOnError();
    ids.set(account.email, data.user.id);
  }

  // Accounts registered while testing are removed so the project is back to the demo accounts.
  const keep = new Set(ACCOUNTS.map((account) => account.email));
  const { data: profiles } = await db.from('profiles').select('id, email').throwOnError();
  for (const profile of profiles.filter((p) => !keep.has(p.email))) {
    const { error } = await db.auth.admin.deleteUser(profile.id); // cascades to the profile
    if (error) throw new Error(`Could not remove the account ${profile.email}: ${error.message}`);
  }
  return ids;
}

function describeMenu(store: Tables<'stores'>, menuItems: Tables<'menu_items'>[]): string {
  const popular = menuItems.filter((item) => item.is_popular).length;
  const unavailable = menuItems.filter((item) => !item.is_available).length;
  const limited = menuItems.filter((item) => item.stock_quantity !== null);
  const stock = limited.map((item) => `${item.name} ${item.stock_quantity}`).join(', ');
  return `  Store     ${store.name} (${store.area}) — ${menuItems.length} menu items (${popular} popular, ${unavailable} unavailable)${stock ? `\n  Stock     ${stock}` : ''}`;
}

/** Seeds brands with their stores and menus; `ownerIds` is empty in production, which has no demo accounts. */
async function seedBrands(brands: SeedBrand[], ownerIds: Map<string, string>): Promise<string[]> {
  const lines: string[] = [];
  for (const brand of brands) {
    for (const { store, menu } of await seedBrand(brand, ownerIds)) {
      lines.push(describeMenu(store, await seedMenu(store.id, menu)));
    }
  }
  return lines;
}

async function seedDemo(): Promise<void> {
  // Checked before anything is wiped, so a missing secret never leaves staging half-reset.
  if (env.APP_ENV === 'staging') {
    const missing = DEMO_ACCOUNTS.map((a) => a.stagingPassword).filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Set ${missing.join(', ')} (12+ characters each) to seed staging: its demo accounts must not use the passwords published in README.md.`,
      );
    }
  }
  // Orders are demo data: wipe them so numbering starts from #1001 again.
  await db.rpc('reset_demo_orders').throwOnError();

  const ownerIds = await seedAccounts();
  const stores = await seedBrands(BRANDS, ownerIds);
  // Back to the defaults, so every demo reset (and every test run) starts from the same limits.
  await db
    .from('site_settings')
    .update({
      customer_order_history_limit: 20,
      staff_order_list_limit: 100,
      max_lines_per_order: 30,
      order_poll_ms: 4000,
      orders_poll_ms: 8000,
      staff_board_poll_ms: 4000,
      client_error_sample_percent: 100,
      min_client_version: '0.0.0',
      updated_by: null,
    })
    .eq('id', true)
    .throwOnError();

  // Never log emails or passwords, in any environment (CWE-532): logs can be centralized and read by more people
  // than the terminal that ran the seed. Demo logins are documented in README.md "Test accounts" instead.
  const accounts = ACCOUNTS.map((account) => account.role).join(', ');

  logger.info(`
Seeded Food Pickup (${env.APP_ENV}: ${env.SUPABASE_URL})
${stores.join('\n')}
  Orders    next order number is #1001

Test accounts (${accounts}) — see README.md "Test accounts" for logins
`);
}

async function setUpProduction(): Promise<void> {
  const { data: existing } = await db
    .from('stores')
    .select('name')
    .limit(1)
    .maybeSingle()
    .throwOnError();
  if (existing) {
    logger.info(
      `Production already has ${existing.name}; nothing was changed. Edit the live menu in the Supabase dashboard.`,
    );
    return;
  }

  const stores = await seedBrands(BRANDS.slice(0, 1), new Map());
  logger.info(`
Set up Food Pickup (production: ${env.SUPABASE_URL})
${stores.join('\n')}

No accounts were created. To add a staff member: Supabase dashboard → Authentication → Add user (auto-confirm),
then in the SQL editor: update public.profiles set role = 'STAFF' where email = '<their email>';
`);
}

async function main(): Promise<void> {
  const productionFlag = process.argv.includes('--production');
  if (env.APP_ENV !== 'production') {
    if (productionFlag) throw new Error(`--production was passed but APP_ENV is ${env.APP_ENV}.`);
    return seedDemo();
  }
  if (!productionFlag) {
    throw new Error(
      'APP_ENV is production, and the demo seed wipes every order and account. ' +
        'For first-time setup of an empty production project run `pnpm run seed --production` instead.',
    );
  }
  return setUpProduction();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Seed failed');
  process.exitCode = 1;
});
