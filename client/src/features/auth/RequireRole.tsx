import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '../../types/api';
import { useAuthStore } from './authStore';

/** One role's routes (the staff board, the admin dashboard): anonymous -> login, anyone else -> home. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!token) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (user?.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
