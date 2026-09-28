// Local and staging (`npm run seed`): an idempotent demo reset. Wipes all orders, then refreshes the single store,
// its menu and the two test accounts. The store, menu items and test accounts keep their ids across re-seeds, so a
// browser that is already signed in or has a saved cart keeps working.
//
// Production (`npm run seed -- --production`): first-time setup only. Creates the store and menu while production
// has no store yet, and nothing else: no wipes, and no test accounts with well-known passwords.
import { env } from '../src/utils/env';
import { logger } from '../src/utils/logger';
import { supabaseAdmin as db } from '../src/utils/supabase';
import type { Role } from '../src/types/enums';
import type { Tables } from '../src/types/database';

const STORE = {
  name: 'Campus Cafe',
  tagline: 'Coffee • Snacks • Quick Bites',
  description: 'Quick bites, coffee and snacks.',
  image_url: '/images/cafe-cover.jpg',
  is_open: true,
  prep_time_min_minutes: 10,
  prep_time_max_minutes: 15,
};

interface SeedMenuItem {
  category: string;
  name: string;
  price: number;
  description: string;
  imageUrl: string;
  isPopular?: boolean;
  isAvailable?: boolean;
  /** Units in stock; omit for items that are not stock-limited. */
  stockQuantity?: number;
}

// Array order defines sort_order (and therefore category order on the menu). Images live in client/public/images.
// Three items are stock-limited to demo the "Only N left" flow; re-seeding resets their stock.
const MENU: SeedMenuItem[] = [
  {
    category: 'Coffee',
    name: 'Cold Coffee',
    price: 120,
    description: 'Creamy chilled coffee, blended smooth',
    imageUrl: '/images/cold-coffee.jpg',
    isPopular: true,
  },
  {
    category: 'Coffee',
    name: 'Espresso',
    price: 90,
    description: 'Bold double shot, freshly pulled',
    imageUrl: '/images/espresso.jpg',
  },
  {
    category: 'Coffee',
    name: 'Cappuccino',
    price: 140,
    description: 'Velvety steamed milk over rich espresso',
    imageUrl: '/images/cappuccino.jpg',
    isPopular: true,
  },
  {
    category: 'Snacks',
    name: 'Veg Sandwich',
    price: 150,
    description: 'Grilled with fresh veggies, cheese and mint chutney',
    imageUrl: '/images/veg-sandwich.jpg',
    isPopular: true,
  },
  {
    category: 'Snacks',
    name: 'French Fries',
    price: 120,
    description: 'Crispy, golden, lightly salted',
    imageUrl: '/images/french-fries.jpg',
    isPopular: true,
  },
  {
    category: 'Snacks',
    name: 'Cheese Toast',
    price: 130,
    description: 'Buttery toast with melted cheese and herbs',
    imageUrl: '/images/cheese-toast.jpg',
    stockQuantity: 1,
  },
  {
    category: 'Juices',
    name: 'Orange Juice',
    price: 100,
    description: 'Freshly squeezed, no added sugar',
    imageUrl: '/images/orange-juice.jpg',
  },
  {
    category: 'Juices',
    name: 'Watermelon Juice',
    price: 110,
    description: 'Cold-pressed and refreshing',
    imageUrl: '/images/watermelon-juice.jpg',
  },
  {
    category: 'Juices',
    name: 'Berry Smoothie',
    price: 150,
    description: 'Mixed berries blended with yogurt',
    imageUrl: '/images/berry-smoothie.jpg',
    isAvailable: false,
  },
  {
    category: 'Desserts',
    name: 'Chocolate Brownie',
    price: 110,
    description: 'Fudgy, dense, with a crackly top',
    imageUrl: '/images/chocolate-brownie.jpg',
    stockQuantity: 2,
  },
  {
    category: 'Desserts',
    name: 'Blueberry Muffin',
    price: 90,
    description: 'Soft-baked with bursting blueberries',
    imageUrl: '/images/blueberry-muffin.jpg',
    stockQuantity: 5,
  },
];

type StagingPasswordKey = 'SEED_STAFF_PASSWORD' | 'SEED_ADMIN_PASSWORD' | 'SEED_CUSTOMER_PASSWORD';

// The published passwords (README.md "Test accounts") work locally only. Shared staging is reachable by anyone who
// reads the README, so there every account's password comes from the deployment (seedDemo checks all of them first).
const DEMO_ACCOUNTS: {
  role: Role;
  name: string;
  email: string;
  localPassword: string;
  stagingPassword: StagingPasswordKey;
  phone: string | null;
}[] = [
  {
    role: 'STAFF',
    name: 'Campus Cafe Staff',
    email: 'staff@campuscafe.local',
    localPassword: 'staff123',
    stagingPassword: 'SEED_STAFF_PASSWORD',
    phone: null,
  },
  {
    // The site-wide admin dashboard (/admin). Not a restaurant role: it has no staff powers.
    role: 'ADMIN',
    name: 'Site Admin',
    email: 'admin@campuscafe.local',
    localPassword: 'admin123',
    stagingPassword: 'SEED_ADMIN_PASSWORD',
    phone: null,
  },
  {
    role: 'CUSTOMER',
    name: 'Anishka',
    email: 'anishka@example.com',
    localPassword: 'test1234',
    stagingPassword: 'SEED_CUSTOMER_PASSWORD',
    phone: '9876543210',
  },
];

const ACCOUNTS = DEMO_ACCOUNTS.map(({ localPassword, stagingPassword, ...account }) => ({
  ...account,
  password: env.APP_ENV === 'staging' ? (env[stagingPassword] ?? '') : localPassword,
}));

async function seedStore(): Promise<Tables<'stores'>> {
  const { data: existing } = await db
    .from('stores')
    .select('id')
    .limit(1)
    .maybeSingle()
    .throwOnError();
  const { data: store } = existing
    ? await db.from('stores').update(STORE).eq('id', existing.id).select().single().throwOnError()
    : await db.from('stores').insert(STORE).select().single().throwOnError();
  return store;
}

async function seedMenu(storeId: string): Promise<Tables<'menu_items'>[]> {
  const { data: current } = await db
    .from('menu_items')
    .select('id, name')
    .eq('store_id', storeId)
    .throwOnError();
  const idByName = new Map(current.map((item) => [item.name, item.id]));

  const items: Tables<'menu_items'>[] = [];
  for (const [index, item] of MENU.entries()) {
    const row = {
      store_id: storeId,
      category: item.category,
      name: item.name,
      description: item.description,
      price: item.price,
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

  // Items dropped from the list above disappear from the menu (safe: orders were wiped first).
  const keep = new Set(MENU.map((item) => item.name));
  const stale = current.filter((item) => !keep.has(item.name)).map((item) => item.id);
  if (stale.length > 0) await db.from('menu_items').delete().in('id', stale).throwOnError();
  return items;
}

async function seedAccounts(): Promise<void> {
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
  }

  // Accounts registered while testing are removed so the project is back to the two test accounts.
  const keep = new Set(ACCOUNTS.map((account) => account.email));
  const { data: profiles } = await db.from('profiles').select('id, email').throwOnError();
  for (const profile of profiles.filter((p) => !keep.has(p.email))) {
    const { error } = await db.auth.admin.deleteUser(profile.id); // cascades to the profile
    if (error) throw new Error(`Could not remove the account ${profile.email}: ${error.message}`);
  }
}

function describeMenu(store: Tables<'stores'>, menuItems: Tables<'menu_items'>[]): string {
  const popular = menuItems.filter((item) => item.is_popular).length;
  const unavailable = menuItems.filter((item) => !item.is_available).length;
  const limited = menuItems.filter((item) => item.stock_quantity !== null);
  return `  Store     ${store.name} — ${menuItems.length} menu items (${popular} popular, ${unavailable} unavailable)
  Stock     ${limited.map((item) => `${item.name} ${item.stock_quantity}`).join(', ')} (everything else unlimited)`;
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

  const store = await seedStore();
  const menuItems = await seedMenu(store.id);
  await seedAccounts();
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
${describeMenu(store, menuItems)}
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

  const store = await seedStore();
  const menuItems = await seedMenu(store.id);
  logger.info(`
Set up Food Pickup (production: ${env.SUPABASE_URL})
${describeMenu(store, menuItems)}

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
        'For first-time setup of an empty production project run `npm run seed -- --production` instead.',
    );
  }
  return setUpProduction();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Seed failed');
  process.exitCode = 1;
});
