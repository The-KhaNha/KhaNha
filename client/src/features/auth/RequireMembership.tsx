import type { ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuthStore } from './authStore';

/**
 * The order board's routes: anonymous -> login; someone with no store role, or none at this route's store
 * (`:storeSlug`), -> home. The server decides again on every call; this only keeps the wrong person off the screen.
 */
export function RequireMembership({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const { storeSlug } = useParams();
  const location = useLocation();

  if (!token) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  const allowed = user?.memberships.some((m) => !storeSlug || m.storeSlug === storeSlug);
  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}
