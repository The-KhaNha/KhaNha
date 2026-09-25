// Idempotent seed: wipes all orders, then refreshes the single store, its menu and the two test accounts.
// The store, menu items and test accounts keep their ids across re-seeds, so a browser that already has a
// login token or a saved cart keeps working. Run with `npm run seed` from server/.
import { Role, type MenuItem } from '@prisma/client';
import { hashPassword } from '../src/utils/password';
import { prisma } from '../src/utils/prisma';

const STORE = {
  name: 'Campus Cafe',
  tagline: 'Coffee • Snacks • Quick Bites',
  description: 'Quick bites, coffee and snacks.',
  imageUrl: '/images/cafe-cover.jpg',
  isOpen: true,
  prepTimeMinMinutes: 10,
  prepTimeMaxMinutes: 15,
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

// Array order defines sortOrder (and therefore category order on the menu). Images live in client/public/images.
// Three items are stock-limited to demo the "Only N left" flow; re-seeding resets their stock.
const MENU: SeedMenuItem[] = [
  { category: 'Coffee', name: 'Cold Coffee', price: 120, description: 'Creamy chilled coffee, blended smooth', imageUrl: '/images/cold-coffee.jpg', isPopular: true },
  { category: 'Coffee', name: 'Espresso', price: 90, description: 'Bold double shot, freshly pulled', imageUrl: '/images/espresso.jpg' },
  { category: 'Coffee', name: 'Cappuccino', price: 140, description: 'Velvety steamed milk over rich espresso', imageUrl: '/images/cappuccino.jpg', isPopular: true },
  { category: 'Snacks', name: 'Veg Sandwich', price: 150, description: 'Grilled with fresh veggies, cheese and mint chutney', imageUrl: '/images/veg-sandwich.jpg', isPopular: true },
  { category: 'Snacks', name: 'French Fries', price: 120, description: 'Crispy, golden, lightly salted', imageUrl: '/images/french-fries.jpg', isPopular: true },
  { category: 'Snacks', name: 'Cheese Toast', price: 130, description: 'Buttery toast with melted cheese and herbs', imageUrl: '/images/cheese-toast.jpg', stockQuantity: 1 },
  { category: 'Juices', name: 'Orange Juice', price: 100, description: 'Freshly squeezed, no added sugar', imageUrl: '/images/orange-juice.jpg' },
  { category: 'Juices', name: 'Watermelon Juice', price: 110, description: 'Cold-pressed and refreshing', imageUrl: '/images/watermelon-juice.jpg' },
  { category: 'Juices', name: 'Berry Smoothie', price: 150, description: 'Mixed berries blended with yogurt', imageUrl: '/images/berry-smoothie.jpg', isAvailable: false },
  { category: 'Desserts', name: 'Chocolate Brownie', price: 110, description: 'Fudgy, dense, with a crackly top', imageUrl: '/images/chocolate-brownie.jpg', stockQuantity: 2 },
  { category: 'Desserts', name: 'Blueberry Muffin', price: 90, description: 'Soft-baked with bursting blueberries', imageUrl: '/images/blueberry-muffin.jpg', stockQuantity: 5 },
];

const ACCOUNTS = [
  { role: Role.STAFF, name: 'Campus Cafe Staff', email: 'staff@campuscafe.local', password: 'staff123', phone: null },
  { role: Role.CUSTOMER, name: 'Anishka', email: 'anishka@example.com', password: 'test1234', phone: '9876543210' },
];

async function seedStore() {
  const existing = await prisma.store.findFirst();
  return existing
    ? prisma.store.update({ where: { id: existing.id }, data: STORE })
    : prisma.store.create({ data: STORE });
}

async function seedMenu(storeId: string): Promise<MenuItem[]> {
  const items: MenuItem[] = [];
  for (const [index, item] of MENU.entries()) {
    const data = {
      ...item,
      isPopular: item.isPopular ?? false,
      isAvailable: item.isAvailable ?? true,
      // Explicit null (not undefined) so re-seeding resets stock on items that used to be limited.
      stockQuantity: item.stockQuantity ?? null,
      sortOrder: index + 1,
      storeId,
    };
    const existing = await prisma.menuItem.findFirst({ where: { storeId, name: item.name } });
    items.push(
      existing
        ? await prisma.menuItem.update({ where: { id: existing.id }, data })
        : await prisma.menuItem.create({ data }),
    );
  }
  // Items dropped from the list above disappear from the menu (safe: orders were wiped first).
  await prisma.menuItem.deleteMany({ where: { storeId, name: { notIn: MENU.map((item) => item.name) } } });
  return items;
}

async function seedAccounts(): Promise<void> {
  for (const { password, ...account } of ACCOUNTS) {
    const passwordHash = await hashPassword(password);
    await prisma.user.upsert({
      where: { email: account.email },
      update: { ...account, passwordHash },
      create: { ...account, passwordHash },
    });
  }
  // Accounts registered while testing are removed so the database is back to the two test accounts.
  await prisma.user.deleteMany({ where: { email: { notIn: ACCOUNTS.map((account) => account.email) } } });
}

async function main(): Promise<void> {
  // Orders are demo data: wipe them so numbering starts from #1001 again.
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.$executeRaw`ALTER SEQUENCE "Order_orderNumber_seq" RESTART WITH 1001`;

  const store = await seedStore();
  const menuItems = await seedMenu(store.id);
  await seedAccounts();

  const popular = menuItems.filter((item) => item.isPopular).length;
  const unavailable = menuItems.filter((item) => !item.isAvailable).length;
  const limited = menuItems.filter((item) => item.stockQuantity !== null);

  console.log(`
Seeded Food Pickup
  Store     ${store.name} — ${menuItems.length} menu items (${popular} popular, ${unavailable} unavailable)
  Stock     ${limited.map((item) => `${item.name} ${item.stockQuantity}`).join(', ')} (everything else unlimited)
  Orders    next order number is #1001

Test accounts
  STAFF     staff@campuscafe.local / staff123
  CUSTOMER  anishka@example.com / test1234
`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
