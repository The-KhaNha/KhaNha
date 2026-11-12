import type { ManagedMenuItem } from '../../types/api';

/** The editor lists live items only: an archived one is read-only and has no controls. */
export const liveItems = (items: ManagedMenuItem[]) => items.filter((i) => !i.archivedAt);

export const categoryNames = (items: ManagedMenuItem[]): string[] => [
  ...new Set(items.map((i) => i.category)),
];

export function filterItems(items: ManagedMenuItem[], query: string, category: string | null) {
  const q = query.trim().toLowerCase();
  return items.filter(
    (i) => (!category || i.category === category) && (!q || i.name.toLowerCase().includes(q)),
  );
}

/**
 * Swaps an item with its neighbour in the same category (the menu is grouped by category, so a move never crosses
 * one). Null at an edge: the button is disabled there.
 */
export function moveItem(
  items: ManagedMenuItem[],
  id: string,
  direction: -1 | 1,
): ManagedMenuItem[] | null {
  const from = items.findIndex((i) => i.id === id);
  if (from < 0) return null;
  let to = from + direction;
  while (items[to] && items[to]!.category !== items[from]!.category) to += direction;
  if (!items[to]) return null;
  const next = [...items];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** Whether the item has a neighbour to swap with in that direction. */
export const canMove = (items: ManagedMenuItem[], id: string, direction: -1 | 1) =>
  moveItem(items, id, direction) !== null;
