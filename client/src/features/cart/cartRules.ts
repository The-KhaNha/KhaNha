import type { MenuItem } from '../../types/api';
import type { CartLine } from './cartStore';

/** Mirrors the server's per-line cap (server/src/schemas/order.schema.ts). */
export const MAX_LINE_QUANTITY = 10;

/** Menu cards flag in-stock items with this many units left or fewer. */
export const LOW_STOCK_MAX = 5;

type Stockable = Pick<MenuItem, 'isAvailable' | 'stockQuantity'>;

/**
 * How many of a menu item a customer can add right now:
 * 0 when it is unavailable, its stock when tracked, null when there is no stock limit.
 */
export function availableQuantity(item: Stockable): number | null {
  return item.isAvailable ? item.stockQuantity : 0;
}

/** True for an in-stock item that is about to run out ("Only N left"). */
export function isLowStock<T extends Stockable>(item: T): item is T & { stockQuantity: number } {
  return item.isAvailable && item.stockQuantity !== null && item.stockQuantity <= LOW_STOCK_MAX;
}

/** "Sold out" when tracked stock ran out, "Unavailable" when the shop switched the item off. */
export function unavailableLabel(item: Pick<MenuItem, 'stockQuantity'>): string {
  return item.stockQuantity === 0 ? 'Sold out' : 'Unavailable';
}

/** The most of one item a cart may hold: its stock limit when there is one, otherwise the per-order cap. */
export function lineLimit(maxQuantity: number | null | undefined): number {
  return Math.min(MAX_LINE_QUANTITY, maxQuantity ?? MAX_LINE_QUANTITY);
}

export type LineProblem = { kind: 'sold-out' } | { kind: 'over-limit'; available: number };

/** Why a cart line cannot be ordered as it stands, or null when it is fine. */
export function lineProblem(line: Pick<CartLine, 'quantity' | 'maxQuantity'>): LineProblem | null {
  const limit = lineLimit(line.maxQuantity);
  if (limit <= 0) return { kind: 'sold-out' };
  if (line.quantity > limit) return { kind: 'over-limit', available: limit };
  return null;
}

/** Short chip text for a flagged line: "Sold out" / "Only 1 left". */
export function problemLabel(problem: LineProblem): string {
  return problem.kind === 'sold-out' ? 'Sold out' : `Only ${problem.available} left`;
}

/** Full sentence naming the item, matching the server's wording: "Only 1 Cheese Toast left." */
export function describeProblem(name: string, problem: LineProblem): string {
  return problem.kind === 'sold-out'
    ? `${name} is sold out.`
    : `Only ${problem.available} ${name} left.`;
}

/** One sentence per flagged line, so a message never says "some item" without naming it. */
export function describeProblems(lines: CartLine[]): string {
  return lines
    .flatMap((line) => {
      const problem = lineProblem(line);
      return problem ? [describeProblem(line.name, problem)] : [];
    })
    .join(' ');
}

/** Caption under a stepper whose plus has stopped: the stock left, or the per-order cap. */
export function limitCaption(maxQuantity: number | null | undefined): string {
  return maxQuantity !== null && maxQuantity !== undefined && maxQuantity < MAX_LINE_QUANTITY
    ? `Only ${maxQuantity} available`
    : `Max ${MAX_LINE_QUANTITY} per order`;
}

/** Server error codes that are about one specific cart line; `error.details` says which. */
const ITEM_ERROR_CODES: readonly string[] = [
  'INSUFFICIENT_STOCK',
  'ITEM_UNAVAILABLE',
  'ITEM_NOT_FOUND',
];

export function isItemErrorCode(code: string): boolean {
  return ITEM_ERROR_CODES.includes(code);
}
