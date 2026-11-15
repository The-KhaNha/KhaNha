import { useEffect, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, CircleAlert } from 'lucide-react';
import { Card } from '../../components/Card';
import { Wordmark } from '../../components/Wordmark';
import { getSupabase } from '../../lib/supabase';

interface AuthCardProps {
  title: string;
  subtitle: string;
  error?: string | null;
  children: ReactNode;
  /** The link to the other auth page; it keeps the query string so ?next survives the switch. */
  footer: { prompt: string; to: '/login' | '/register'; label: string };
  backTo?: string;
}

/** Shared frame for the Login and Register pages. */
export function AuthCard({
  title,
  subtitle,
  error,
  children,
  footer,
  backTo = '/',
}: AuthCardProps) {
  // Sign-in needs supabase-js, which the app does not load up front: fetch it while the form is being filled in. A
  // failure here is kept (lib/supabase.ts), and sending the form then asks for a reload.
  useEffect(() => {
    getSupabase().catch(() => {});
  }, []);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 pt-4 md:max-w-lg md:justify-center">
      <div className="flex items-center justify-between">
        <Link
          to={backTo}
          // Back means back: to the cart a guest came from, or to sign-in with its ?next. The route guards redirect
          // with replace, so history never loops. A fresh tab (no earlier entry) falls back to backTo.
          onClick={(event) => {
            if (location.key === 'default') return;
            event.preventDefault();
            navigate(-1);
          }}
          className="-ml-2 inline-flex h-11 items-center gap-1 rounded-full pl-2 pr-3 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden /> Back
        </Link>
        <Wordmark />
      </div>

      <Card padding="xl" className="mt-8 animate-fade-up">
        <h1 className="text-title font-extrabold leading-tight">{title}</h1>
        <p className="mt-1.5 text-body text-muted">{subtitle}</p>

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-2xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700 animate-fade-in"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6">{children}</div>
      </Card>

      <p className="mt-6 text-center text-body text-muted">
        {footer.prompt}{' '}
        <Link
          to={{ pathname: footer.to, search: location.search }}
          className="inline-flex min-h-11 items-center font-semibold text-brand-600 underline-offset-2 hover:text-brand-700 hover:underline"
        >
          {footer.label}
        </Link>
      </p>
    </main>
  );
}
