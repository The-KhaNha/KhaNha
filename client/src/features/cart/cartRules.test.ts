import { describe, expect, it } from 'vitest';
import {
  MAX_LINE_QUANTITY,
  availableQuantity,
  describeProblem,
  describeProblems,
  isItemErrorCode,
  isLowStock,
  limitCaption,
  lineLimit,
  lineProblem,
  problemLabel,
  unavailableLabel,
} from './cartRules';
import type { CartLine } from './cartStore';

describe('availableQuantity', () => {
  it('is 0 when the item is unavailable, regardless of stock', () => {
    expect(availableQuantity({ isAvailable: false, stockQuantity: 10 })).toBe(0);
    expect(availableQuantity({ isAvailable: false, stockQuantity: null })).toBe(0);
  });

  it('is the tracked stock when available', () => {
    expect(availableQuantity({ isAvailable: true, stockQuantity: 3 })).toBe(3);
  });

  it('is null (unlimited) when available with no stock tracking', () => {
    expect(availableQuantity({ isAvailable: true, stockQuantity: null })).toBeNull();
  });
});

describe('isLowStock', () => {
  it('is true for a tracked item at or below the threshold', () => {
    expect(isLowStock({ isAvailable: true, stockQuantity: 5 })).toBe(true);
    expect(isLowStock({ isAvailable: true, stockQuantity: 1 })).toBe(true);
  });

  it('is false above the threshold, when unavailable, or when untracked', () => {
    expect(isLowStock({ isAvailable: true, stockQuantity: 6 })).toBe(false);
    expect(isLowStock({ isAvailable: false, stockQuantity: 1 })).toBe(false);
    expect(isLowStock({ isAvailable: true, stockQuantity: null })).toBe(false);
  });
});

describe('unavailableLabel', () => {
  it('is "Sold out" when tracked stock is exactly 0', () => {
    expect(unavailableLabel({ stockQuantity: 0 })).toBe('Sold out');
  });

  it('is "Unavailable" otherwise (switched off, or untracked)', () => {
    expect(unavailableLabel({ stockQuantity: null })).toBe('Unavailable');
    expect(unavailableLabel({ stockQuantity: 5 })).toBe('Unavailable');
  });
});

describe('lineLimit', () => {
  it('is the per-order cap when there is no stock limit', () => {
    expect(lineLimit(null)).toBe(MAX_LINE_QUANTITY);
    expect(lineLimit(undefined)).toBe(MAX_LINE_QUANTITY);
  });

  it('is the smaller of stock and the per-order cap', () => {
    expect(lineLimit(3)).toBe(3);
    expect(lineLimit(999)).toBe(MAX_LINE_QUANTITY);
  });
});

function cartLine(overrides: Partial<CartLine> = {}): Pick<CartLine, 'quantity' | 'maxQuantity'> {
  return { quantity: 1, maxQuantity: null, ...overrides };
}

describe('lineProblem', () => {
  it('is null when the quantity is within the limit', () => {
    expect(lineProblem(cartLine({ quantity: 2, maxQuantity: 5 }))).toBeNull();
  });

  it('is "sold-out" when the limit is 0', () => {
    expect(lineProblem(cartLine({ quantity: 1, maxQuantity: 0 }))).toEqual({ kind: 'sold-out' });
  });

  it('is "over-limit" with the available count when the quantity exceeds the limit', () => {
    expect(lineProblem(cartLine({ quantity: 3, maxQuantity: 2 }))).toEqual({
      kind: 'over-limit',
      available: 2,
    });
  });
});

describe('problemLabel / describeProblem', () => {
  it('problemLabel: short chip text', () => {
    expect(problemLabel({ kind: 'sold-out' })).toBe('Sold out');
    expect(problemLabel({ kind: 'over-limit', available: 1 })).toBe('Only 1 left');
  });

  it('describeProblem: full sentence naming the item, matching the server wording', () => {
    expect(describeProblem('Cheese Toast', { kind: 'sold-out' })).toBe('Cheese Toast is sold out.');
    expect(describeProblem('Cheese Toast', { kind: 'over-limit', available: 1 })).toBe(
      'Only 1 Cheese Toast left.',
    );
  });
});

describe('describeProblems', () => {
  it('joins one sentence per flagged line and skips lines with no problem', () => {
    const lines: CartLine[] = [
      {
        menuItemId: '1',
        name: 'Cheese Toast',
        unitPrice: 130,
        imageUrl: null,
        quantity: 2,
        maxQuantity: 1,
      },
      {
        menuItemId: '2',
        name: 'Cold Coffee',
        unitPrice: 120,
        imageUrl: null,
        quantity: 1,
        maxQuantity: null,
      },
      {
        menuItemId: '3',
        name: 'Brownie',
        unitPrice: 110,
        imageUrl: null,
        quantity: 1,
        maxQuantity: 0,
      },
    ];
    expect(describeProblems(lines)).toBe('Only 1 Cheese Toast left. Brownie is sold out.');
  });

  it('is empty when nothing is flagged', () => {
    const lines: CartLine[] = [
      {
        menuItemId: '1',
        name: 'Cold Coffee',
        unitPrice: 120,
        imageUrl: null,
        quantity: 1,
        maxQuantity: null,
      },
    ];
    expect(describeProblems(lines)).toBe('');
  });
});

describe('limitCaption', () => {
  it('names the stock left when it is below the per-order cap', () => {
    expect(limitCaption(3)).toBe('Only 3 available');
  });

  it('names the per-order cap otherwise', () => {
    expect(limitCaption(null)).toBe(`Max ${MAX_LINE_QUANTITY} per order`);
    expect(limitCaption(undefined)).toBe(`Max ${MAX_LINE_QUANTITY} per order`);
    expect(limitCaption(MAX_LINE_QUANTITY)).toBe(`Max ${MAX_LINE_QUANTITY} per order`);
  });
});

describe('isItemErrorCode', () => {
  it('is true for the three cart-line error codes', () => {
    expect(isItemErrorCode('INSUFFICIENT_STOCK')).toBe(true);
    expect(isItemErrorCode('ITEM_UNAVAILABLE')).toBe(true);
    expect(isItemErrorCode('ITEM_NOT_FOUND')).toBe(true);
  });

  it('is false for anything else', () => {
    expect(isItemErrorCode('VALIDATION_ERROR')).toBe(false);
    expect(isItemErrorCode('STORE_CLOSED')).toBe(false);
  });
});
