// The demo fixtures `npm run seed` writes: the store, its menu and the test accounts. Data only; seed.ts owns what
// happens to it. Kept typed (not JSON) so a wrong field fails typecheck.
import type { Role } from '../src/types/enums';

export const STORE = {
  name: 'Campus Cafe',
  tagline: 'Coffee • Snacks • Quick Bites',
  description: 'Quick bites, coffee and snacks.',
  image_url: '/images/cafe-cover.jpg',
  is_open: true,
  prep_time_min_minutes: 10,
  prep_time_max_minutes: 15,
};

export interface SeedMenuItem {
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
export const MENU: SeedMenuItem[] = [
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

export type StagingPasswordKey =
  'SEED_STAFF_PASSWORD' | 'SEED_ADMIN_PASSWORD' | 'SEED_CUSTOMER_PASSWORD';

// The published passwords (README.md "Test accounts") work locally only. Shared staging is reachable by anyone who
// reads the README, so there every account's password comes from the deployment (seedDemo checks all of them first).
export const DEMO_ACCOUNTS: {
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
