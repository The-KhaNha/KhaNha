// Who may do what at a store (P2.2, ADR-001). One map from capability to the roles that hold it; a capability is
// added with the route that checks it. docs/PERMISSIONS.md "Store roles" is the table in prose.
import type { AuthUser } from '../types/auth';
import type { StoreRole } from '../types/enums';

/** The caller's standing at one store: the brand's owner, a membership, the platform admin, or nothing. */
export type StoreAccess = 'OWNER' | StoreRole | 'ADMIN';

const MATRIX = {
  'orders.view': ['STAFF', 'MANAGER', 'OWNER'],
  'orders.transition': ['STAFF', 'MANAGER', 'OWNER'],
  // ADMIN pauses a store as support; it has no other kitchen power (CLAUDE.md §2).
  'store.pause': ['STAFF', 'MANAGER', 'OWNER', 'ADMIN'],
  'hours.edit': ['MANAGER', 'OWNER'],
  'settings.edit': ['MANAGER', 'OWNER'],
  'team.manageStaff': ['MANAGER', 'OWNER', 'ADMIN'],
  'team.manageManagers': ['OWNER', 'ADMIN'],
  'audit.store': ['MANAGER', 'OWNER', 'ADMIN'],
} as const satisfies Record<string, readonly StoreAccess[]>;

export type Capability = keyof typeof MATRIX;

export function can(access: StoreAccess | null, capability: Capability): boolean {
  return access !== null && (MATRIX[capability] as readonly StoreAccess[]).includes(access);
}

/**
 * The caller's access at `store` for `capability`: of their standings there (the brand's owner, their membership, the
 * platform admin), the first that holds the capability, else the first they have, else null. An admin who also works
 * a store keeps both: the membership for the kitchen, ADMIN for support.
 */
export function accessFor(
  user: Pick<AuthUser, 'role' | 'memberships' | 'ownedBrandIds'>,
  store: { id: string; brandId: string },
  capability: Capability,
): StoreAccess | null {
  const standings: StoreAccess[] = [];
  if (user.ownedBrandIds.includes(store.brandId)) standings.push('OWNER');
  const membership = user.memberships.find((m) => m.storeId === store.id);
  if (membership) standings.push(membership.role);
  if (user.role === 'ADMIN') standings.push('ADMIN');
  return standings.find((access) => can(access, capability)) ?? standings[0] ?? null;
}
