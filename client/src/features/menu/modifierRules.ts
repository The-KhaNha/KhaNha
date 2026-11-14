import { formatPrice } from '../../lib/format';
import type { MenuItem, ModifierGroup, OrderItem } from '../../types/api';
import type { CartOption } from '../cart/cartStore';

/** The options chosen in each of an item's groups, by group id. */
export type Selection = Record<string, string[]>;

/** An item offers choices: its card says "Customisable" and its Add opens the item sheet. */
export function isCustomisable(item: Pick<MenuItem, 'modifierGroupIds'>): boolean {
  return (item.modifierGroupIds?.length ?? 0) > 0;
}

/** The item's groups in its order; a group the menu does not carry (an older saved menu) is skipped. */
export function itemGroups(
  item: Pick<MenuItem, 'modifierGroupIds'>,
  groups: Record<string, ModifierGroup> | undefined,
): ModifierGroup[] {
  return (item.modifierGroupIds ?? []).flatMap((id) => (groups?.[id] ? [groups[id]] : []));
}

/** Each group starts at its available defaults (at most maxSelect), as the server would fill a required one. */
export function defaultSelection(groups: ModifierGroup[]): Selection {
  return Object.fromEntries(
    groups.map((g) => [
      g.id,
      g.options
        .filter((o) => o.isDefault && o.isAvailable)
        .slice(0, g.maxSelect)
        .map((o) => o.id),
    ]),
  );
}

/**
 * A tap on an option: a one-choice group switches to it (an optional one also goes back to none on a second tap);
 * others add it (while under maxSelect) or remove it.
 */
export function toggleOption(
  group: ModifierGroup,
  selection: Selection,
  optionId: string,
): Selection {
  // Live choices only: a stale (gone or sold-out) one must not hold a place against the cap, and a tap drops it.
  const current = liveChoices(group, selection).map((o) => o.id);
  if (group.maxSelect === 1)
    return {
      ...selection,
      [group.id]: group.minSelect === 0 && current.includes(optionId) ? [] : [optionId],
    };
  if (current.includes(optionId))
    return { ...selection, [group.id]: current.filter((id) => id !== optionId) };
  if (current.length >= group.maxSelect) return selection;
  return { ...selection, [group.id]: [...current, optionId] };
}

/**
 * A group's chosen options that the menu still offers and has: a choice made before the menu reloaded may be gone or
 * sold out, and is then no answer (not counted, priced or sent).
 */
export function liveChoices(group: ModifierGroup, selection: Selection) {
  const chosen = selection[group.id] ?? [];
  return group.options.filter((o) => o.isAvailable && chosen.includes(o.id));
}

/** The groups still short of their minimum, in order. */
export function missingGroups(groups: ModifierGroup[], selection: Selection): ModifierGroup[] {
  return groups.filter((g) => liveChoices(g, selection).length < g.minSelect);
}

/** The chosen options as a cart line keeps them, in the groups' and options' order. */
export function chosenOptions(groups: ModifierGroup[], selection: Selection): CartOption[] {
  return groups.flatMap((g) =>
    liveChoices(g, selection).map((o) => ({
      id: o.id,
      groupName: g.name,
      name: o.name,
      priceDelta: o.priceDelta,
    })),
  );
}

/** The line under a group's name: "Choose 1", "Choose up to 3", "Choose 2 to 3", "Optional". */
export function choiceHint(group: Pick<ModifierGroup, 'minSelect' | 'maxSelect'>): string {
  const { minSelect: min, maxSelect: max } = group;
  if (min === max) return `Choose ${min}`;
  if (min === 0) return max === 1 ? 'Optional' : `Optional, up to ${max}`;
  return min === 1 ? `Choose up to ${max}` : `Choose ${min} to ${max}`;
}

/** "Large, Oat milk": a cart line's options in one line. */
export function optionsLabel(options: Pick<CartOption, 'name'>[]): string {
  return options.map((o) => o.name).join(', ');
}

/** "+₹20", "−₹20", or nothing for a free option. */
export function deltaLabel(priceDelta: number): string {
  if (priceDelta === 0) return '';
  return priceDelta > 0 ? `+${formatPrice(priceDelta)}` : `−${formatPrice(-priceDelta)}`;
}

/** "Large, Oat milk" for an order line (its options as they were when ordered), or '' for a line without any. */
export function orderLineOptions(item: Pick<OrderItem, 'modifiers'>): string {
  return (item.modifiers ?? []).map((m) => m.optionName).join(', ');
}
