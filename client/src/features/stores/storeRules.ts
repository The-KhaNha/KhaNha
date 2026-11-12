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
