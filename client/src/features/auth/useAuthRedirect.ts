import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../../types/api';
import { homeFor } from './roles';

/** After login/register: staff and admins go to their dashboard, customers back to ?next or home. */
export function useAuthRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  return function redirectAfterAuth(user: User) {
    if (user.role !== 'CUSTOMER') {
      navigate(homeFor(user.role), { replace: true });
      return;
    }
    const next = params.get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    navigate(safeNext, { replace: true });
  };
}
