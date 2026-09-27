import { NavLink } from 'react-router-dom';
import { House, ReceiptText, UserRound, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const items: NavItem[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/orders', label: 'Orders', icon: ReceiptText },
  { to: '/profile', label: 'Profile', icon: UserRound },
];

/** Fixed bottom navigation. Never animates on route changes; the active pill just recolours. */
export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/92 backdrop-blur-md pb-safe"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-3 md:max-w-lg">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'relative flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40',
                isActive ? 'text-brand-600' : 'text-muted hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'grid h-8 w-12 place-items-center rounded-full transition-colors duration-200',
                    isActive && 'bg-brand-50',
                  )}
                >
                  <Icon
                    className="h-[22px] w-[22px]"
                    strokeWidth={isActive ? 2.4 : 2}
                    aria-hidden
                  />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
