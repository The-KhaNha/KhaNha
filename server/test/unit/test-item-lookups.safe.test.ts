// Every brand template (P3.1) holds copies of its menu, so a test that finds a menu item by name across all stores
// gets the store's item or the template's copy, whichever the database returns first: an order then fails at random.
// A test's menu_items query that filters by name must also filter by store.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TEST_ROOT = path.resolve(__dirname, '..');

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Each `.from('menu_items')` chain, up to the end of its statement. */
function menuItemQueries(source: string): string[] {
  return source
    .split(".from('menu_items')")
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf(';')));
}

describe('test lookups of menu items by name', () => {
  for (const file of testFiles(TEST_ROOT)) {
    const unscoped = menuItemQueries(readFileSync(file, 'utf8')).filter(
      (query) => /\.(eq|in)\('name'/.test(query) && !/\.(eq|in)\('store_id'/.test(query),
    );
    it(`${path.relative(TEST_ROOT, file)} scopes each one to a store`, () => {
      expect(unscoped).toEqual([]);
    });
  }
});
