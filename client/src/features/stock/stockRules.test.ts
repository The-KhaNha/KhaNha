import { describe, expect, it } from 'vitest';
import type { StockMovement } from '../../types/api';
import { canSeeStock, describeMovement, stockLevel } from './stockRules';

describe('stockLevel', () => {
  it('reads the count against the threshold', () => {
    expect(stockLevel(null, 3)).toBe('untracked');
    expect(stockLevel(0, 3)).toBe('out');
    expect(stockLevel(3, 3)).toBe('low');
    expect(stockLevel(4, 3)).toBe('ok');
    expect(stockLevel(1, 0)).toBe('ok');
  });
});

describe('canSeeStock', () => {
  const m = (role: 'STAFF' | 'MANAGER', staffCanEditStock?: boolean) => ({
    storeId: 's',
    storeSlug: 's',
    storeName: 'S',
    role,
    staffCanEditStock,
  });
  it('follows the setting for staff, never for a manager', () => {
    expect(canSeeStock(m('STAFF', true))).toBe(true);
    expect(canSeeStock(m('STAFF', false))).toBe(false);
    expect(canSeeStock(m('STAFF'))).toBe(true);
    expect(canSeeStock(m('MANAGER', false))).toBe(true);
    expect(canSeeStock(undefined)).toBe(false);
  });
});

describe('describeMovement', () => {
  const mv = (
    delta: number | null,
    resultingQuantity: number | null,
    reason: StockMovement['reason'],
  ) =>
    ({
      id: 1,
      menuItemId: 'a',
      delta,
      resultingQuantity,
      reason,
      actor: null,
      createdAt: '',
    }) as StockMovement;
  it('says each kind of change', () => {
    expect(describeMovement(mv(null, null, 'MANUAL_SET'))).toBe('Stopped counting');
    expect(describeMovement(mv(null, 5, 'MANUAL_SET'))).toBe('Counting from 5');
    expect(describeMovement(mv(2, 12, 'MANUAL_SET'))).toBe('Set to 12');
    expect(describeMovement(mv(3, 15, 'MANUAL_ADJUST'))).toBe('+3 → 15');
    expect(describeMovement(mv(-1, 14, 'MANUAL_ADJUST'))).toBe('−1 → 14');
    expect(describeMovement(mv(-2, 12, 'WASTE'))).toBe('Wasted 2 → 12');
  });
});
