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
 * Whether the cart holds items of another store than `storeId`. An empty cart belongs to no one. A menu's limits and
 * stock are applied to the cart only when this is false, and adding asks for confirmation when it is true.
 */
export function cartHoldsOtherStore(
  cart: { lines: unknown[]; storeId: string | null },
  storeId: string,
): boolean {
  return cart.lines.length > 0 && cart.storeId !== storeId;
}
