import { formatPrice } from '../../lib/format';
import type { PushField } from '../../services/manageStores';
import type { ManagedMenuItem } from '../../types/api';

export const PUSH_FIELDS: { key: PushField; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'diet', label: 'Veg / non-veg' },
  { key: 'photo', label: 'Photo' },
];

const DIET: Record<string, string> = { VEG: 'Veg', NON_VEG: 'Non-veg', EGG: 'Egg' };
const shown = (field: Exclude<PushField, 'photo'>, item: ManagedMenuItem): string => {
  switch (field) {
    case 'price':
      return formatPrice(item.price);
    case 'diet':
      return item.diet ? DIET[item.diet]! : 'not marked';
    default:
      return item[field] || '(blank)';
  }
};

const raw = (field: Exclude<PushField, 'photo'>, item: ManagedMenuItem) =>
  field === 'price' ? item.price : (item[field] ?? null);

/**
 * What a push of `fields` from `template` will do at one branch: "Price at North Gate: ₹120 → ₹140" per field that
 * differs, "North Gate gets a new copy" when it has none, or nothing when its copy already matches. A branch older than
 * lineage may have its own item of the same name (not linked): the new copy would sit beside it, so it says so.
 */
export function pushPreview(
  template: ManagedMenuItem,
  branchName: string,
  copy: ManagedMenuItem | undefined,
  fields: PushField[],
  ownSameName = false,
): string[] {
  if (!copy)
    return [
      ownSameName
        ? `${branchName} gets a new copy beside its own “${template.name}”`
        : `${branchName} gets a new copy`,
    ];
  return PUSH_FIELDS.filter(({ key }) => fields.includes(key)).flatMap(({ key, label }) => {
    if (key === 'photo')
      return copy.imageUrl === template.imageUrl ? [] : [`Photo at ${branchName}: replaced`];
    // The raw values decide; `shown` only describes a difference ("(blank)" is a label, not a value).
    if (raw(key, copy) === raw(key, template)) return [];
    return [`${label} at ${branchName}: ${shown(key, copy)} → ${shown(key, template)}`];
  });
}
