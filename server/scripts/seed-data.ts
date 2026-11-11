// The demo fixtures `pnpm run seed` writes: the store, its menu and the test accounts. Data only; seed.ts owns what
// happens to it. Kept typed (not JSON) so a wrong field fails typecheck.
import type { Role, StoreRole } from '../src/types/enums';

export interface SeedStore {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  image_url: string;
  is_open: boolean;
  prep_time_min_minutes: number;
  prep_time_max_minutes: number;
  area: string;
  address_line: string;
  menu: SeedMenuItem[];
}

export interface SeedBrand {
  name: string;
  slug: string;
  description: string;
  /** Email of the demo account that owns the brand; production has no demo accounts, so it seeds none. */
  ownerEmail: string;
  stores: SeedStore[];
}

export interface SeedMenuItem {
  category: string;
  name: string;
  /** Whole rupees in paise (the database refuses anything else while the API sends rupees). */
  pricePaise: number;
  description: string;
  imageUrl: string;
  isPopular?: boolean;
  isAvailable?: boolean;
  /** Units in stock; omit for items that are not stock-limited. */
  stockQuantity?: number;
}

// Array order defines sort_order (and therefore category order on the menu). Images live in client/public/images.
// Three items are stock-limited to demo the "Only N left" flow; re-seeding resets their stock.
export const CAMPUS_CAFE_MENU: SeedMenuItem[] = [
  {
    category: 'Coffee',
    name: 'Cold Coffee',
    pricePaise: 12000,
    description: 'Creamy chilled coffee, blended smooth',
    imageUrl: '/images/cold-coffee.jpg',
    isPopular: true,
  },
  {
    category: 'Coffee',
    name: 'Espresso',
    pricePaise: 9000,
    description: 'Bold double shot, freshly pulled',
    imageUrl: '/images/espresso.jpg',
  },
  {
    category: 'Coffee',
    name: 'Cappuccino',
    pricePaise: 14000,
    description: 'Velvety steamed milk over rich espresso',
    imageUrl: '/images/cappuccino.jpg',
    isPopular: true,
  },
  {
    category: 'Snacks',
    name: 'Veg Sandwich',
    pricePaise: 15000,
    description: 'Grilled with fresh veggies, cheese and mint chutney',
    imageUrl: '/images/veg-sandwich.jpg',
    isPopular: true,
  },
  {
    category: 'Snacks',
    name: 'French Fries',
    pricePaise: 12000,
    description: 'Crispy, golden, lightly salted',
    imageUrl: '/images/french-fries.jpg',
    isPopular: true,
  },
  {
    category: 'Snacks',
    name: 'Cheese Toast',
    pricePaise: 13000,
    description: 'Buttery toast with melted cheese and herbs',
    imageUrl: '/images/cheese-toast.jpg',
    stockQuantity: 1,
  },
  {
    category: 'Juices',
    name: 'Orange Juice',
    pricePaise: 10000,
    description: 'Freshly squeezed, no added sugar',
    imageUrl: '/images/orange-juice.jpg',
  },
  {
    category: 'Juices',
    name: 'Watermelon Juice',
    pricePaise: 11000,
    description: 'Cold-pressed and refreshing',
    imageUrl: '/images/watermelon-juice.jpg',
  },
  {
    category: 'Juices',
    name: 'Berry Smoothie',
    pricePaise: 15000,
    description: 'Mixed berries blended with yogurt',
    imageUrl: '/images/berry-smoothie.jpg',
    isAvailable: false,
  },
  {
    category: 'Desserts',
    name: 'Chocolate Brownie',
    pricePaise: 11000,
    description: 'Fudgy, dense, with a crackly top',
    imageUrl: '/images/chocolate-brownie.jpg',
    stockQuantity: 2,
  },
  {
    category: 'Desserts',
    name: 'Blueberry Muffin',
    pricePaise: 9000,
    description: 'Soft-baked with bursting blueberries',
    imageUrl: '/images/blueberry-muffin.jpg',
    stockQuantity: 5,
  },
];

/** Campus Cafe's menu; the other stores' menus are their own copies of a shorter list. */
export const MENU = CAMPUS_CAFE_MENU;

// "Campus Cafe" is today's single store and full menu. "Brew Lane" is a chain with two branches in different areas,
// each with its own copy of a short menu (P2: a store's menu belongs to the store).
const BREW_LANE_MENU: SeedMenuItem[] = CAMPUS_CAFE_MENU.filter((item) =>
  ['Espresso', 'Cappuccino', 'Veg Sandwich', 'Chocolate Brownie'].includes(item.name),
).map((item) => ({ ...item, isPopular: false, stockQuantity: undefined }));

const BREW_LANE_STORE = {
  tagline: 'Coffee • Sandwiches • Brownies',
  description: 'A small coffee chain with the same short menu at every branch.',
  image_url: '/images/cafe-cover.jpg',
  is_open: true,
  prep_time_min_minutes: 8,
  prep_time_max_minutes: 12,
  menu: BREW_LANE_MENU,
};

export const BRANDS: SeedBrand[] = [
  {
    name: 'Campus Cafe',
    slug: 'campus-cafe',
    description: 'Quick bites, coffee and snacks.',
    ownerEmail: 'owner@campuscafe.local',
    stores: [
      {
        name: 'Campus Cafe',
        slug: 'campus-cafe',
        tagline: 'Coffee • Snacks • Quick Bites',
        description: 'Quick bites, coffee and snacks.',
        image_url: '/images/cafe-cover.jpg',
        is_open: true,
        prep_time_min_minutes: 10,
        prep_time_max_minutes: 15,
        area: 'Main Campus',
        address_line: 'Student Centre, Ground Floor',
        menu: CAMPUS_CAFE_MENU,
      },
    ],
  },
  {
    name: 'Brew Lane',
    slug: 'brew-lane',
    description: 'A small coffee chain with two branches.',
    ownerEmail: 'owner@brewlane.local',
    stores: [
      {
        ...BREW_LANE_STORE,
        name: 'Brew Lane North Gate',
        slug: 'brew-lane-north-gate',
        area: 'North Gate',
        address_line: '12 Library Road',
      },
      {
        ...BREW_LANE_STORE,
        name: 'Brew Lane Tech Park',
        slug: 'brew-lane-tech-park',
        area: 'Tech Park',
        address_line: 'Block B, Tech Park Plaza',
      },
    ],
  },
];

export type StagingPasswordKey =
  'SEED_STAFF_PASSWORD' | 'SEED_ADMIN_PASSWORD' | 'SEED_CUSTOMER_PASSWORD' | 'SEED_OWNER_PASSWORD';

// The published passwords (README.md "Test accounts") work locally only. Shared staging is reachable by anyone who
// reads the README, so there every account's password comes from the deployment (seedDemo checks all of them first).
export const DEMO_ACCOUNTS: {
  role: Role;
  name: string;
  email: string;
  localPassword: string;
  stagingPassword: StagingPasswordKey;
  phone: string | null;
  /** The store the account works at (P2.2), by slug. */
  store?: { slug: string; role: StoreRole };
}[] = [
  // A staff member and a manager per store. Their profile role is STAFF until P2 PR 16, so the old staff board
  // (/staff) still admits them; every store team account shares SEED_STAFF_PASSWORD on staging.
  ...teamAccounts('Campus Cafe', 'campuscafe.local', 'campus-cafe'),
  ...teamAccounts('North Gate', 'northgate.brewlane.local', 'brew-lane-north-gate'),
  ...teamAccounts('Tech Park', 'techpark.brewlane.local', 'brew-lane-tech-park'),
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
  // Brand owners are CUSTOMER profiles: brands.owner_id makes them OWNER of every store of their brand.
  {
    role: 'CUSTOMER',
    name: 'Campus Cafe Owner',
    email: 'owner@campuscafe.local',
    localPassword: 'owner123',
    stagingPassword: 'SEED_OWNER_PASSWORD',
    phone: null,
  },
  {
    role: 'CUSTOMER',
    name: 'Brew Lane Owner',
    email: 'owner@brewlane.local',
    localPassword: 'owner123',
    stagingPassword: 'SEED_OWNER_PASSWORD',
    phone: null,
  },
];

function teamAccounts(storeName: string, domain: string, slug: string) {
  return (['STAFF', 'MANAGER'] as const).map((role) => ({
    role: 'STAFF' as const,
    name: `${storeName} ${role === 'STAFF' ? 'Staff' : 'Manager'}`,
    email: `${role.toLowerCase()}@${domain}`,
    localPassword: `${role.toLowerCase()}123`,
    stagingPassword: 'SEED_STAFF_PASSWORD' as const,
    phone: null,
    store: { slug, role },
  }));
}
