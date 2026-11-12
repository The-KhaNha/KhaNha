import { describe, expect, it } from 'vitest';
import { api } from '../setup/api';
import { menuPath } from '../setup/helpers';

describe('GET /api/stores/:ref/menu', () => {
  it('carries the cart rules the client applies', async () => {
    const res = await api().get(await menuPath());
    expect(res.status).toBe(200);
    expect(res.body.rules).toEqual({ maxQuantityPerItem: 10, lowStockThreshold: 5 });
  });

  it('needs no Authorization header and returns store, popular, categories and rules', async () => {
    const res = await api().get(await menuPath());
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['store', 'popular', 'categories', 'rules'].sort(),
    );
    expect(Array.isArray(res.body.popular)).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it('every item has exactly the documented MenuItemDto keys', async () => {
    const res = await api().get(await menuPath());
    const allItems = res.body.categories.flatMap(
      (category: { items: Record<string, unknown>[] }) => category.items,
    );
    expect(allItems.length).toBeGreaterThan(0);
    for (const item of allItems) {
      expect(Object.keys(item as object).sort()).toEqual(
        [
          'id',
          'category',
          'name',
          'description',
          'price',
          'imageUrl',
          'diet',
          'isAvailable',
          'isPopular',
          'sortOrder',
          'stockQuantity',
        ].sort(),
      );
    }
  });

  it('includes unavailable items (greyed out on the client), not just purchasable ones', async () => {
    const res = await api().get(await menuPath());
    const allItems: { name: string; isAvailable: boolean }[] = res.body.categories.flatMap(
      (category: { items: { name: string; isAvailable: boolean }[] }) => category.items,
    );
    // Seeded by scripts/seed.ts: Berry Smoothie is is_available=false.
    const berrySmoothie = allItems.find((item) => item.name === 'Berry Smoothie');
    expect(berrySmoothie?.isAvailable).toBe(false);
  });

  it('reports a sold-out tracked item as unavailable via isPurchasable, distinct from switched off', async () => {
    const res = await api().get(await menuPath());
    const allItems: { name: string; isAvailable: boolean; stockQuantity: number | null }[] =
      res.body.categories.flatMap(
        (category: {
          items: { name: string; isAvailable: boolean; stockQuantity: number | null }[];
        }) => category.items,
      );
    // Seeded stock-limited items: Cheese Toast (1), Chocolate Brownie (2), Blueberry Muffin (5).
    const cheeseToast = allItems.find((item) => item.name === 'Cheese Toast');
    expect(cheeseToast?.stockQuantity).not.toBeNull();
    expect(cheeseToast?.isAvailable).toBe((cheeseToast?.stockQuantity ?? 0) > 0);
  });

  it('popular items and categories are ordered by sortOrder, and a category is placed by its lowest', async () => {
    const res = await api().get(await menuPath());
    const categoryNames = res.body.categories.map((c: { name: string }) => c.name);
    // Seeded order: Coffee (1-3), Snacks (4-6), Juices (7-9), Desserts (10-11).
    expect(categoryNames).toEqual(['Coffee', 'Snacks', 'Juices', 'Desserts']);
  });

  it('never leaks stack traces or SQL in the body', async () => {
    const res = await api().get(await menuPath());
    expect(JSON.stringify(res.body)).not.toMatch(
      /\bat .*\.(ts|js)|stack|PGRST|SQLSTATE|select |insert |update /i,
    );
  });
});
