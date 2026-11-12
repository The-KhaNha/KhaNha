import type { StoreSummary, User } from '../../types/api';

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

/** The picker's list: the active stores the account can manage (a paused or closed-down store is not listed). */
export const managedStores = (user: User, stores: StoreSummary[]): StoreSummary[] =>
  stores.filter((s) => canManage(user, s));

export const MANAGE_TABS = [
  { path: 'hours', label: 'Hours' },
  { path: 'settings', label: 'Settings' },
  { path: 'team', label: 'Team' },
] as const;
