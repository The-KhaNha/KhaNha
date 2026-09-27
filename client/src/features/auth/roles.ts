import type { Role } from '../../types/api';

/** Where each role lands after signing in (and where /login and /register send someone already signed in). */
export function homeFor(role: Role): string {
  if (role === 'STAFF') return '/staff';
  if (role === 'ADMIN') return '/admin';
  return '/';
}
