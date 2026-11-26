import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Mail,
  Phone,
  ReceiptText,
  Settings,
  UserRound,
} from 'lucide-react';
import { Button, ButtonLink } from '../components/Button';
import { Card } from '../components/Card';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { EmptyState } from '../components/EmptyState';
import { selectUser, useAuthStore } from '../features/auth/authStore';
import { ApiError } from '../services/api';
import { leaveStore } from '../services/manage';
import type { User } from '../types/api';
import { worksAStore } from '../features/auth/roles';
import { APP_COMMIT, APP_VERSION } from '../lib/appVersion';
import { cn } from '../lib/cn';
import { initialOf } from '../lib/format';
import { hrefFor } from '../lib/hosts';
import { runtimeEnv } from '../lib/runtimeEnv';
import { APP_TITLE } from '../config/app';

export function ProfilePage() {
  const user = useAuthStore(selectUser);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  if (!user) {
    return (
      <EmptyState
        icon={UserRound}
        title="You're not signed in"
        description="Sign in to see your profile, track orders and check out faster."
        action={
          <>
            <ButtonLink to="/login?next=%2Fprofile" size="lg">
              Sign in
            </ButtonLink>
            <ButtonLink to="/register" variant="ghost">
              Create an account
            </ButtonLink>
          </>
        }
      />
    );
  }

  function handleLogout() {
    logout();
    navigate('/', { replace: true });
  }

  return (
    <div className="space-y-4 pt-4 animate-fade-up">
      <Card padding="lg">
        {/* Wraps at large text: beside the 4rem avatar the name was squeezed to a letter at 200%. */}
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand-50 text-2xl font-extrabold text-brand-700">
            {initialOf(user.name)}
          </span>
          <div className="min-w-0 flex-1 basis-32">
            <h2 className="truncate text-xl font-extrabold">{user.name}</h2>
            {user.role !== 'CUSTOMER' && (
              <span className="mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-bold uppercase tracking-wider text-muted">
                {user.role === 'ADMIN' ? 'Admin' : 'Staff'}
              </span>
            )}
          </div>
        </div>
        <dl className="mt-5 space-y-3 border-t border-line/70 pt-5 text-body">
          <div className="flex items-center gap-3">
            <dt className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
              <Mail className="h-4 w-4" aria-hidden />
              <span className="sr-only">Email</span>
            </dt>
            <dd className="min-w-0 truncate">{user.email}</dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
              <Phone className="h-4 w-4" aria-hidden />
              <span className="sr-only">Phone</span>
            </dt>
            <dd className={user.phone ? 'tabular-nums' : 'text-muted'}>
              {user.phone ?? 'No phone added'}
            </dd>
          </div>
        </dl>
      </Card>

      {user.memberships.length > 0 && <YourStores memberships={user.memberships} />}

      <Card padding="none" className="overflow-hidden">
        <ProfileRow
          to="/orders"
          icon={<ReceiptText className="h-5 w-5" aria-hidden />}
          label="Order history"
        />
        {worksAStore(user) && (
          <ProfileRow
            to={hrefFor('/staff', window.location, runtimeEnv.hosts)}
            icon={<LayoutDashboard className="h-5 w-5" aria-hidden />}
            label="Staff dashboard"
            className="border-t border-line/70"
          />
        )}
        {user.role === 'ADMIN' && (
          <ProfileRow
            to={hrefFor('/admin', window.location, runtimeEnv.hosts)}
            icon={<Settings className="h-5 w-5" aria-hidden />}
            label="Admin dashboard"
            className="border-t border-line/70"
          />
        )}
      </Card>

      <Button
        variant="secondary"
        fullWidth
        size="lg"
        onClick={handleLogout}
        className="hover:text-cancel-700"
        iconLeft={<LogOut className="h-5 w-5" aria-hidden />}
      >
        Log out
      </Button>

      {/* Tells support which build a customer runs; staging builds share a version, the commit tells them apart. */}
      <p className="text-center text-xs text-hint">
        {APP_TITLE} v{APP_VERSION} ({APP_COMMIT.slice(0, 7)})
      </p>
    </div>
  );
}

type Membership = User['memberships'][number];

/** The stores this account works at, each with a way to leave it (the owner's brands are not memberships). */
function YourStores({ memberships }: { memberships: Membership[] }) {
  const removeMembership = useAuthStore((s) => s.removeMembership);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [leaving, setLeaving] = useState<Membership | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    const store = leaving;
    if (!store) return;
    setBusy(true);
    setError(null);
    try {
      await leaveStore(store.storeId);
      removeMembership(store.storeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      // A lost reply may have left the store anyway, or a manager removed this account already: read it again so
      // the list shows what the server holds instead of a store every Leave refuses.
      void hydrate();
    } finally {
      setBusy(false);
      // Back may have closed this sheet and another one opened meanwhile: close only this one.
      setLeaving((open) => (open === store ? null : open));
    }
  }

  return (
    <Card as="section" padding="lg" aria-labelledby="your-stores">
      <h2 id="your-stores" className="text-lg font-extrabold">
        Your stores
      </h2>
      <ul className="mt-2 divide-y divide-line/70">
        {memberships.map((m) => (
          <li key={m.storeId} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="wrap-anywhere font-semibold">{m.storeName}</p>
              <p className="text-caption text-muted">
                {m.role === 'MANAGER' ? 'Manager' : 'Staff'}
              </p>
            </div>
            <Button
              variant="ghost-danger"
              aria-label={`Leave ${m.storeName}`}
              onClick={() => setLeaving(m)}
            >
              Leave
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-brand-700">
          {error}
        </p>
      )}
      {leaving && (
        <ConfirmSheet
          title={`Leave ${leaving.storeName}?`}
          text="You lose its orders and tools at once. A manager can invite you back."
          confirmLabel="Leave"
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setLeaving(null)}
        />
      )}
    </Card>
  );
}

interface ProfileRowProps {
  to: string;
  icon: ReactNode;
  label: string;
  className?: string;
}

function ProfileRow({ to, icon, label, className }: ProfileRowProps) {
  return (
    <Link
      to={to}
      className={cn(
        'flex h-16 items-center gap-3 px-5 text-body font-semibold transition-colors hover:bg-surface-2 active:bg-line/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
        className,
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-600">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
    </Link>
  );
}
