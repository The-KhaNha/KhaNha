import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../../types/api';
import { homeOnHost } from '../../lib/hosts';
import { runtimeEnv } from '../../lib/runtimeEnv';
import { homeFor } from './roles';

/** The account's home (homeFor), kept on this host: the other hosts keep their own sign-in (lib/hosts.ts). */
export function homeHere(user: User): string {
  return homeOnHost(homeFor(user), window.location.host, runtimeEnv.hosts);
}

/**
 * After login/register: back to ?next (where the person was going, e.g. /join with an invite) when it stays inside the
 * app, for every account; otherwise to the account's own home on this host (homeHere).
 */
export function useAuthRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  return function redirectAfterAuth(user: User) {
    const next = params.get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
    navigate(safeNext ?? homeHere(user), { replace: true });
  };
}
