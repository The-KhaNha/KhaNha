import type { StockMovement, User } from '../../types/api';

/** How an item's count reads at a glance: not counted, sold out, low (at or under the threshold), or fine. */
export type StockLevel = 'untracked' | 'out' | 'low' | 'ok';

export function stockLevel(stock: number | null, lowStockThreshold: number): StockLevel {
  if (stock === null) return 'untracked';
  if (stock === 0) return 'out';
  return stock <= lowStockThreshold ? 'low' : 'ok';
}

/**
 * Whether the staff board offers its Stock view: a MANAGER always, STAFF while the store lets them. A profile saved
 * before the setting existed lacks it and reads as the server's default (on); the server checks every request.
 */
export const canSeeStock = (membership: User['memberships'][number] | undefined): boolean =>
  !!membership && (membership.role === 'MANAGER' || membership.staffCanEditStock !== false);

/** One line of an item's history, e.g. "Set to 12", "+3 → 15", "Wasted 2 → 13", "Stopped counting". */
export function describeMovement(m: StockMovement): string {
  if (m.resultingQuantity === null) return 'Stopped counting';
  if (m.delta === null) return `Counting from ${m.resultingQuantity}`;
  if (m.reason === 'MANUAL_SET') return `Set to ${m.resultingQuantity}`;
  if (m.reason === 'WASTE') return `Wasted ${-m.delta} → ${m.resultingQuantity}`;
  return `${m.delta > 0 ? '+' : '−'}${Math.abs(m.delta)} → ${m.resultingQuantity}`;
}
