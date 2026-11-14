import type { CreateOrderInput, MenuItem, MenuResponse } from '../../types/api';
import type { CartLine } from './cartStore';

/** The store's limits as the menu serves them (`MenuResponse.rules`): the per-line cap and the "Only N left" point. */
export type CartLimits = NonNullable<MenuResponse['rules']>;

type Stockable = Pick<MenuItem, 'isAvailable' | 'stockQuantity'>;

/**
 * How many of a menu item a customer can add right now:
 * 0 when it is unavailable, its stock when tracked, null when there is no stock limit.
 */
export function availableQuantity(item: Stockable): number | null {
  return item.isAvailable ? item.stockQuantity : 0;
}

/** True for an in-stock item that is about to run out ("Only N left"). */
export function isLowStock<T extends Stockable>(
  item: T,
  limits: CartLimits,
): item is T & { stockQuantity: number } {
  return (
    item.isAvailable &&
    item.stockQuantity !== null &&
    item.stockQuantity <= limits.lowStockThreshold
  );
}

/** "Sold out" when tracked stock ran out, "Unavailable" when the shop switched the item off. */
export function unavailableLabel(item: Pick<MenuItem, 'stockQuantity'>): string {
  return item.stockQuantity === 0 ? 'Sold out' : 'Unavailable';
}

/** The most of one item a cart may hold: its stock limit when there is one, otherwise the per-order cap. */
export function lineLimit(maxQuantity: number | null | undefined, limits: CartLimits): number {
  return Math.min(limits.maxQuantityPerItem, maxQuantity ?? limits.maxQuantityPerItem);
}

export type LineProblem = { kind: 'sold-out' } | { kind: 'over-limit'; available: number };

type ProblemLine = Pick<CartLine, 'lineKey' | 'menuItemId' | 'quantity' | 'maxQuantity'>;

/** The most this line may hold: its item's limit less what the item's other lines in `lines` hold. */
export function lineAllowance(
  line: ProblemLine,
  limits: CartLimits,
  lines: ProblemLine[] = [line],
): number {
  const others = lines.reduce(
    (sum, l) =>
      l.menuItemId === line.menuItemId && l.lineKey !== line.lineKey ? sum + l.quantity : sum,
    0,
  );
  return lineLimit(line.maxQuantity, limits) - others;
}

/**
 * Why a cart line cannot be ordered as it stands, or null when it is fine. The limit is the item's, shared by all its
 * lines (`lines`, the whole cart): a line may hold what the item's other lines leave.
 */
export function lineProblem(
  line: ProblemLine,
  limits: CartLimits,
  lines: ProblemLine[] = [line],
): LineProblem | null {
  const limit = lineAllowance(line, limits, lines);
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
export function describeProblems(lines: CartLine[], limits: CartLimits): string {
  return lines
    .flatMap((line) => {
      const problem = lineProblem(line, limits, lines);
      return problem ? [describeProblem(line.name, problem)] : [];
    })
    .join(' ');
}

/** Caption under a stepper whose plus has stopped: the stock left, or the per-order cap. */
export function limitCaption(maxQuantity: number | null | undefined, limits: CartLimits): string {
  return maxQuantity !== null &&
    maxQuantity !== undefined &&
    maxQuantity < limits.maxQuantityPerItem
    ? `Only ${maxQuantity} available`
    : `Max ${limits.maxQuantityPerItem} per order`;
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

/**
 * The order's items: each line carries the price on screen, so a price moved since it was added is refused (409
 * PRICE_CHANGED) instead of charged. A line whose price the server could never accept (0 or fractional, kept in an
 * old persisted cart) sends none, so it is charged the database price as before, rather than a 400 on every retry.
 */
export function orderItems(lines: CartLine[]): CreateOrderInput['items'] {
  return lines.map(({ menuItemId, quantity, unitPrice, options }) => ({
    menuItemId,
    quantity,
    // ₹0 only with options (Small −₹30 on a ₹30 item): an item alone is never free, so a plain ₹0 is an old cart's.
    ...(Number.isInteger(unitPrice) && (unitPrice > 0 || (unitPrice === 0 && options.length > 0))
      ? { expectedUnitPrice: unitPrice }
      : {}),
    // Only with options: a server or menu without modifiers never sees the field.
    ...(options.length ? { modifierOptionIds: options.map((o) => o.id) } : {}),
  }));
}
