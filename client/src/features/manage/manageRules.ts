import type { MyBrand, StoreRole, StoreStatus, StoreSummary, User } from '../../types/api';

/**
 * Whether the account may open `/manage` for this store: the owner of its brand, a MANAGER member, or an ADMIN
 * (who holds the team and pause capabilities everywhere, docs/PERMISSIONS.md). The server enforces it again on
 * every write; this only decides what the client offers.
 */
export function canManage(user: User, store: Pick<StoreSummary, 'id' | 'brand'>): boolean {
  return (
    user.role === 'ADMIN' ||
    user.ownedBrands.some((b) => b.id === store.brand.id) ||
    user.memberships.some((m) => m.storeId === store.id && m.role === 'MANAGER')
  );
}

/**
 * Whether the account may edit the opening hours (`hours.edit`, docs/PERMISSIONS.md): the brand's owner or a MANAGER
 * member. An ADMIN can open `/manage` but holds no hours capability, so the editor is not offered.
 */
export const canEditHours = (user: User, store: Pick<StoreSummary, 'id' | 'brand'>): boolean =>
  user.ownedBrands.some((b) => b.id === store.brand.id) ||
  user.memberships.some((m) => m.storeId === store.id && m.role === 'MANAGER');

export const MANAGE_TABS = [
  { path: 'menu', label: 'Menu' },
  { path: 'stock', label: 'Stock' },
  { path: 'hours', label: 'Hours' },
  { path: 'settings', label: 'Settings' },
  { path: 'team', label: 'Team' },
] as const;

/** `settings.edit`: MANAGER and OWNER. An admin holds no store-settings capability, so is not offered the editor. */
export function canEditSettings(user: User, store: Pick<StoreSummary, 'id' | 'brand'>): boolean {
  return (
    user.ownedBrands.some((b) => b.id === store.brand.id) ||
    user.memberships.some((m) => m.storeId === store.id && m.role === 'MANAGER')
  );
}

/** `team.manageManagers`: OWNER and ADMIN. Everyone else on the team page deals with STAFF only. */
export function canManageManagers(user: User, store: Pick<StoreSummary, 'brand'>): boolean {
  return user.role === 'ADMIN' || user.ownedBrands.some((b) => b.id === store.brand.id);
}

/** Whether the viewer may remove this person (a manager may leave: remove themselves). */
export const canRemoveMember = (
  user: User,
  store: Pick<StoreSummary, 'brand'>,
  member: { role: StoreRole; userId: string },
): boolean =>
  member.role === 'STAFF' || member.userId === user.id || canManageManagers(user, store);

/** `menu.edit`: MANAGER and OWNER (an admin holds no menu capability). */
export const canEditMenu = canEditHours;

/** The tabs a brand template has: what a new branch copies (no kitchen, no team, no hours, no stock). */
export const TEMPLATE_TABS: readonly string[] = ['menu', 'profile', 'settings'];

/** One row of the `/manage` picker. `note` says what is unusual about it (a template, a branch not yet public). */
export interface PickerEntry {
  id: string;
  slug: string;
  name: string;
  note: string | null;
}

const STATUS_NOTE: Record<StoreStatus, string | null> = {
  DRAFT: 'Draft: not public yet',
  ACTIVE: null,
  SUSPENDED: 'Suspended',
  ARCHIVED: 'Closed',
};

/**
 * The picker's rows: each owned brand's template first, then its branches at every status; then the stores the
 * account manages as a MANAGER; then, for an admin, the public stores. Each store once.
 */
export function pickerEntries(
  user: User,
  brands: MyBrand[] | null,
  publicStores: StoreSummary[] | null,
): PickerEntry[] {
  const rows: PickerEntry[] = [];
  const seen = new Set<string>();
  const add = (row: PickerEntry) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };
  for (const brand of brands ?? []) {
    if (brand.template) add({ ...pick(brand.template), name: brand.name, note: 'Brand template' });
    for (const store of brand.stores) add({ ...pick(store), note: STATUS_NOTE[store.status] });
  }
  for (const m of user.memberships)
    if (m.role === 'MANAGER')
      add({ id: m.storeId, slug: m.storeSlug, name: m.storeName, note: null });
  if (user.role === 'ADMIN')
    for (const s of publicStores ?? []) add({ id: s.id, slug: s.slug, name: s.name, note: null });
  return rows;
}

const pick = (s: { id: string; slug: string; name: string }) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
});

/**
 * The id of the store `slug` names among the account's own (a MANAGER membership, an owned brand's branch or
 * template), read through the manage routes at any status; null when it is none of them (an admin then reads the
 * public store).
 */
export function ownStoreId(user: User, brands: MyBrand[] | null, slug: string): string | null {
  const m = user.memberships.find((x) => x.storeSlug === slug && x.role === 'MANAGER');
  if (m) return m.storeId;
  for (const brand of brands ?? []) {
    const store = [brand.template, ...brand.stores].find((s) => s?.slug === slug);
    if (store) return store.id;
  }
  return null;
}

/** `store.publish`: the brand's owner alone. */
export const canPublish = (user: User, brandId: string): boolean =>
  user.ownedBrands.some((b) => b.id === brandId);
