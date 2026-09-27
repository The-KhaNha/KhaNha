import type { ReactNode } from 'react';
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
import { EmptyState } from '../components/EmptyState';
import { selectUser, useAuthStore } from '../features/auth/authStore';
import { APP_COMMIT, APP_VERSION } from '../lib/appVersion';
import { cn } from '../lib/cn';
import { initialOf } from '../lib/format';

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
        <div className="flex items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand-50 text-[24px] font-extrabold text-brand-700">
            {initialOf(user.name)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-extrabold">{user.name}</h2>
            {user.role !== 'CUSTOMER' && (
              <span className="mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                {user.role === 'ADMIN' ? 'Admin' : 'Staff'}
              </span>
            )}
          </div>
        </div>
        <dl className="mt-5 space-y-3 border-t border-line/70 pt-5 text-[15px]">
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

      <Card padding="none" className="overflow-hidden">
        <ProfileRow
          to="/orders"
          icon={<ReceiptText className="h-5 w-5" aria-hidden />}
          label="Order history"
        />
        {user.role === 'STAFF' && (
          <ProfileRow
            to="/staff"
            icon={<LayoutDashboard className="h-5 w-5" aria-hidden />}
            label="Staff dashboard"
            className="border-t border-line/70"
          />
        )}
        {user.role === 'ADMIN' && (
          <ProfileRow
            to="/admin"
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
        Food Pickup v{APP_VERSION} ({APP_COMMIT.slice(0, 7)})
      </p>
    </div>
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
        'flex h-16 items-center gap-3 px-5 text-[15px] font-semibold transition-colors hover:bg-surface-2 active:bg-line/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40',
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
