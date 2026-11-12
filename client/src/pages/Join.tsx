import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ButtonLink } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { selectUser, useAuthStore } from '../features/auth/authStore';
import { ApiError } from '../services/api';
import { acceptInvite } from '../services/manage';

// The invite token, in memory only. It survives the client-side hop to /login or /register and back (no reload),
// and is gone on a reload: the person opens the link again. Never in a store, localStorage or sessionStorage.
let pendingToken: string | null = null;

const INVALID = 'This invite link is no longer valid. Ask for a new one.';

/** `/join#<token>`: the fragment is read and removed from the address bar first, before anything else runs. */
export function JoinPage() {
  const user = useAuthStore(selectUser);
  const navigate = useNavigate();
  const [token] = useState(() => {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      pendingToken = fragment;
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    }
    return pendingToken;
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);
  // A ref, not an effect cleanup: StrictMode's second effect run would otherwise drop the only completion.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token || !user || started.current === attempt) return;
    started.current = attempt;
    setError(null);
    acceptInvite(token)
      .then((membership) => {
        pendingToken = null;
        // The session's memberships predate this one: add it from the answer itself (a profile reload could be one
        // already in flight, or fail) before landing on a page that checks it.
        useAuthStore.getState().addMembership({
          storeId: membership.store.id,
          storeSlug: membership.store.slug,
          storeName: membership.store.name,
          role: membership.role,
        });
        if (!mounted.current) return;
        navigate(
          membership.role === 'MANAGER'
            ? `/manage/${membership.store.slug}`
            : `/staff/${membership.store.slug}`,
          { replace: true },
        );
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) pendingToken = null;
        setError(
          err instanceof ApiError ? err : new ApiError(0, 'UNREACHABLE', 'Something went wrong.'),
        );
      });
  }, [token, user, attempt, navigate]);

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
      <div className="space-y-3 pt-6 text-center">
        <h1 className="text-xl font-extrabold">Join the team</h1>
        <p className="text-muted">Sign in with the email this invite was sent to.</p>
        <ButtonLink to="/login?next=%2Fjoin" size="lg" fullWidth>
          Sign in
        </ButtonLink>
        <ButtonLink to="/register?next=%2Fjoin" size="lg" fullWidth variant="secondary">
          Create an account
        </ButtonLink>
      </div>
    );
  return (
    <div role="status" aria-busy className="mt-4">
      <span className="sr-only">Joining the team</span>
      <Skeleton className="h-24" />
    </div>
  );
}
