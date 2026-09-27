import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, CircleAlert } from 'lucide-react';
import { Wordmark } from '../../components/Wordmark';

interface AuthCardProps {
  title: string;
  subtitle: string;
  error?: string | null;
  children: ReactNode;
  footer: ReactNode;
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
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 pt-4 md:max-w-lg md:justify-center">
      <div className="flex items-center justify-between">
        <Link
          to={backTo}
          className="-ml-2 inline-flex h-11 items-center gap-1 rounded-full pl-2 pr-3 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden /> Back
        </Link>
        <Wordmark />
      </div>

      <div className="mt-8 rounded-[28px] border border-line/70 bg-surface p-6 shadow-card animate-fade-up md:p-8">
        <h1 className="text-[28px] font-extrabold leading-tight">{title}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>

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
      </div>

      <p className="mt-6 text-center text-[15px] text-muted">{footer}</p>
    </div>
  );
}
