import type { StoreSummary } from '../../types/api';

export interface AreaGroup {
  area: string | null;
  stores: StoreSummary[];
}

/** Groups by `area` in the order the server sent them; stores without an area go last, under no heading. */
export function groupByArea(stores: StoreSummary[]): AreaGroup[] {
  const groups = new Map<string | null, StoreSummary[]>();
  for (const store of stores) groups.set(store.area, [...(groups.get(store.area) ?? []), store]);
  const named = [...groups].filter(([area]) => area !== null);
  const unnamed = groups.get(null);
  return [
    ...named.map(([area, list]) => ({ area, stores: list })),
    ...(unnamed ? [{ area: null, stores: unnamed }] : []),
  ];
}

/**
 * Whether a menu's limits and stock may be applied to the cart: it is empty, or holds this menu's items. Browsing
 * another store must not flag the cart's lines as gone (a cart names no store until P2 PR 12).
 */
export function menuMatchesCart(lines: { menuItemId: string }[], items: { id: string }[]): boolean {
  if (lines.length === 0) return true;
  const ids = new Set(items.map((item) => item.id));
  return lines.some((line) => ids.has(line.menuItemId));
}
