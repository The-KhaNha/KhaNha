import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/schemas/limits';

// Read, not imported: the client's JSON is outside the server's rootDir, and an import would fail typecheck.
const fallbacks = JSON.parse(
  readFileSync(join(__dirname, '../../../client/src/config/fallbacks.json'), 'utf8'),
) as { validation: unknown; storeDefaults: unknown };

describe('field bounds parity', () => {
  it('client/src/config/fallbacks.json validation equals server/src/schemas/limits.ts', () => {
    expect(fallbacks.validation).toEqual(LIMITS);
  });
});

describe('store defaults parity', () => {
  it('client/src/config/fallbacks.json storeDefaults equals the stores column defaults', () => {
    const dir = join(__dirname, '../../supabase/migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    const column = (name: string) =>
      Number(new RegExp(`add column ${name} integer not null default (\\d+)`).exec(sql)?.[1]);
    expect(fallbacks.storeDefaults).toEqual({
      maxQuantityPerItem: column('max_quantity_per_item'),
      lowStockThreshold: column('low_stock_threshold'),
    });
  });
});
