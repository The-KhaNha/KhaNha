/**
 * The price of one order line with its modifiers (P3.2). Pure: the API runs it before place_order to answer early with
 * the same error, and place_order applies the same rules itself inside the order's transaction (the truth; PR 13b).
 * A shared case table (test/fixtures/modifierCases.ts) holds both to one behaviour. Money is paise.
 */

export interface PricingOption {
  id: string;
  name: string;
  priceDeltaPaise: number;
  isDefault: boolean;
  isAvailable: boolean;
}

/** One of the item's groups, not archived, with its options that are not archived, in their order. */
export interface PricingGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: PricingOption[];
}

export interface AppliedModifier {
  optionId: string;
  groupName: string;
  optionName: string;
  priceDeltaPaise: number;
}

export type LinePrice =
  | { ok: true; unitPricePaise: number; basePricePaise: number; applied: AppliedModifier[] }
  | { ok: false; code: 'MODIFIER_REQUIRED' | 'MODIFIER_INVALID'; groupName?: string };

const invalid = (groupName?: string): LinePrice => ({
  ok: false,
  code: 'MODIFIER_INVALID',
  groupName,
});

/**
 * With the store's `modifiers` flag off, a line is the item's price and nothing else: no group is enforced, and a line
 * that names options is refused. With it on:
 * - every chosen option belongs to one of the item's groups, once, and is available;
 * - a required group (min_select > 0) left empty takes its available default options (at most max_select), so an old
 *   client that sends no options still orders; with too few defaults it is MODIFIER_REQUIRED;
 * - min_select ≤ chosen ≤ max_select in every group;
 * - the unit price is the item's plus the chosen deltas, and never below zero.
 */
export function priceLine(
  basePricePaise: number,
  groups: PricingGroup[],
  chosenIds: string[],
  modifiersEnabled: boolean,
): LinePrice {
  if (!modifiersEnabled)
    return chosenIds.length > 0
      ? invalid()
      : { ok: true, unitPricePaise: basePricePaise, basePricePaise, applied: [] };

  const chosen = new Set(chosenIds);
  if (chosen.size !== chosenIds.length) return invalid();
  const known = new Map(groups.flatMap((g) => g.options.map((o) => [o.id, { g, o }] as const)));
  for (const id of chosen) {
    const hit = known.get(id);
    if (!hit) return invalid();
    if (!hit.o.isAvailable) return invalid(hit.g.name);
  }

  const applied: AppliedModifier[] = [];
  for (const group of groups) {
    let picked = group.options.filter((o) => chosen.has(o.id));
    if (picked.length === 0 && group.minSelect > 0)
      picked = group.options.filter((o) => o.isDefault && o.isAvailable).slice(0, group.maxSelect);
    if (picked.length > group.maxSelect) return invalid(group.name);
    if (picked.length < group.minSelect)
      return { ok: false, code: 'MODIFIER_REQUIRED', groupName: group.name };
    for (const o of picked)
      applied.push({
        optionId: o.id,
        groupName: group.name,
        optionName: o.name,
        priceDeltaPaise: o.priceDeltaPaise,
      });
  }

  const unitPricePaise = applied.reduce((sum, m) => sum + m.priceDeltaPaise, basePricePaise);
  if (unitPricePaise < 0) return invalid();
  return { ok: true, unitPricePaise, basePricePaise, applied };
}
