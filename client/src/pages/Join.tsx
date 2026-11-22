import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ButtonLink } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { selectUser, useAuthStore } from '../features/auth/authStore';
import { ApiError } from '../services/api';
import { acceptInvite, acceptOwnerInvite } from '../services/manage';

// The invite token, in memory only. It survives the client-side hop to /login or /register and back (no reload),
// and is gone on a reload: the person opens the link again. Never in a store, localStorage or sessionStorage.
type JoinKind = 'team' | 'owner';

// Kept with its kind, so an owner token picked up on /join/owner is never sent to the team endpoint, or back.
let pending: { kind: JoinKind; token: string } | null = null;

const INVALID = 'This invite link is no longer valid. Ask for a new one.';

/** Where an accepted invite lands, after the session has been told what it now grants. */
async function acceptAndRoute(
  kind: JoinKind,
  token: string,
  userId: string,
): Promise<string | null> {
  // The grant belongs to the account that asked: if the session changed while the request was out, record nothing.
  const stillTheSameAccount = () => useAuthStore.getState().user?.id === userId;
  if (kind === 'owner') {
    const brand = await acceptOwnerInvite(token);
    if (!stillTheSameAccount()) return null;
    useAuthStore.getState().addOwnedBrand(brand);
    return '/manage';
  }
  const membership = await acceptInvite(token);
  if (!stillTheSameAccount()) return null;
  // The session's memberships predate this one: add it from the answer itself (a profile reload could be one
  // already in flight, or fail) before landing on a page that checks it.
  useAuthStore.getState().addMembership({
    storeId: membership.store.id,
    storeSlug: membership.store.slug,
    storeName: membership.store.name,
    role: membership.role,
  });
  return membership.role === 'MANAGER'
    ? `/manage/${membership.store.slug}`
    : `/staff/${membership.store.slug}`;
}

const COPY: Record<JoinKind, { title: string; next: string; busy: string }> = {
  team: { title: 'Join the team', next: '%2Fjoin', busy: 'Joining the team' },
  owner: {
    title: 'Set up your restaurant',
    next: '%2Fjoin%2Fowner',
    busy: 'Setting up your restaurant',
  },
};

export interface JoinPageProps {
  /** `owner`: an owner invite (`/join/owner#<token>`, P7.4a); otherwise a store team invite. */
  kind?: JoinKind;
}

/**
 * `/join#<token>` and `/join/owner#<token>`: the fragment is read and removed from the address bar first, before
 * anything else runs.
 */
export function JoinPage({ kind = 'team' }: JoinPageProps) {
  const copy = COPY[kind];
  const user = useAuthStore(selectUser);
  const navigate = useNavigate();
  const [token] = useState(() => {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      pending = { kind, token: fragment };
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    }
    return pending?.kind === kind ? pending.token : null;
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Which attempt, for which account, has started: a different account signing in may accept afresh.
  const started = useRef('');
  // A ref, not an effect cleanup: StrictMode's second effect run would otherwise drop the only completion.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const key = user ? `${attempt}:${user.id}` : '';
    if (!token || !user || started.current === key) return;
    started.current = key;
    setError(null);
    acceptAndRoute(kind, token, user.id)
      .then((to) => {
        // null: the account changed mid-request. Keep the token for whoever is signed in now.
        if (to === null) return;
        pending = null;
        if (mounted.current) navigate(to, { replace: true });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) pending = null;
        setError(
          err instanceof ApiError ? err : new ApiError(0, 'UNREACHABLE', 'Something went wrong.'),
        );
      });
  }, [token, user, attempt, navigate, kind]);

  if (!token || error?.status === 404)
    return <ErrorState compact title="Invite link" message={INVALID} />;
  if (error)
    return (
      <ErrorState
        compact
        title="Could not join"
        message={error.status === 429 ? error.message : 'We could not check the invite. Try again.'}
        unreachable={error.isUnreachable}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  if (!user)
    return (
      <div className="mx-auto max-w-md space-y-3 px-4 pt-6 text-center">
        <h1 className="text-xl font-extrabold">{copy.title}</h1>
        <p className="text-muted">Sign in with the email this invite was sent to.</p>
        <ButtonLink to={`/login?next=${copy.next}`} size="lg" fullWidth>
          Sign in
        </ButtonLink>
        <ButtonLink to={`/register?next=${copy.next}`} size="lg" fullWidth variant="secondary">
          Create an account
        </ButtonLink>
      </div>
    );
  return (
    <div role="status" aria-busy className="mt-4">
      <span className="sr-only">{copy.busy}</span>
      <Skeleton className="h-24" />
    </div>
  );
}
