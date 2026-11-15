import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../../types/api';
import { homeFor } from './roles';

/**
 * After login/register: back to ?next (where the person was going, e.g. /join with an invite) when it stays inside the
 * app, for every account; otherwise to the account's own home (homeFor).
 */
export function useAuthRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  return function redirectAfterAuth(user: User) {
    const next = params.get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
    navigate(safeNext ?? homeFor(user), { replace: true });
  };
}
