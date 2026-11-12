import type { User } from '../../types/api';

type Account = Pick<User, 'role' | 'memberships' | 'ownedBrands'>;

/**
 * Where an account lands after signing in (and where /login and /register send someone already signed in): an admin to
 * /admin, an owner or manager to /manage, anyone who works a store (or still carries the old STAFF profile role) to
 * the order board, everyone else to the store list.
 */
export function homeFor(user: Account): string {
  if (user.role === 'ADMIN') return '/admin';
  if (user.ownedBrands.length > 0 || user.memberships.some((m) => m.role === 'MANAGER'))
    return '/manage';
  if (user.memberships.length > 0 || user.role === 'STAFF') return '/staff';
  return '/';
}
