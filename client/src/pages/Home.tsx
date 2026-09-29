import { ChefHat, PackageCheck, ShoppingBag, type LucideIcon } from 'lucide-react';
import { ErrorState } from '../components/ErrorState';
import { cardClasses } from '../components/Card';
import { StoreCard, StoreCardSkeleton } from '../components/StoreCard';
import { useStore } from '../features/menu/useStore';

const steps: { icon: LucideIcon; title: string; copy: string }[] = [
  { icon: ShoppingBag, title: 'Order ahead', copy: 'Pick your food, pay in a tap.' },
  { icon: ChefHat, title: 'We prepare it', copy: 'Made fresh while you walk over.' },
  { icon: PackageCheck, title: 'Pick it up', copy: 'Say your order number. Done.' },
];

/**
 * Home: the paprika field runs from the top of the viewport (TopBar tone="brand") and the
 * store card overlaps it so the storefront photo sits on red — the hunger cue.
 */
export function HomePage() {
  const { store, isLoading, error, retry } = useStore();

  return (
    // No page-level fade: the store card's cover is the page's largest paint, and a fading ancestor delays it.
    <div className="pb-6">
      {/* The one permitted decorative gradient in the app. */}
      <section className="-mx-4 rounded-b-card bg-[linear-gradient(180deg,var(--color-brand-500),var(--color-brand-deep))] text-white lg:mx-[calc(50%-50vw)]">
        <div className="mx-auto w-full max-w-md px-4 pb-[72px] pt-4 md:max-w-lg">
          <p className="eyebrow text-white">Campus pickup</p>
          <h1 className="mt-2 text-display font-extrabold leading-none tracking-[-0.02em]">
            Skip the queue.
          </h1>
          <p className="mt-3 max-w-sm text-base font-medium leading-relaxed text-white">
            Order ahead. We&rsquo;ll prepare it while you make your way.
          </p>
        </div>
      </section>

      <div className="relative -mt-14">
        {isLoading ? (
          <StoreCardSkeleton />
        ) : error && !store ? (
          <ErrorState
            compact
            title="Unable to load the shop."
            message={error.message}
            onRetry={retry}
            unreachable={error.isUnreachable}
          />
        ) : (
          store && (
            <>
              <StoreCard store={store} />
              {/* Saved copy shown, refresh failed: keep it, but say so. */}
              {error && (
                <ErrorState
                  compact
                  className="mt-3"
                  title="Showing saved shop details"
                  message="We couldn't refresh them just now."
                  retryLabel="Retry"
                  onRetry={retry}
                  unreachable={error.isUnreachable}
                />
              )}
            </>
          )
        )}
      </div>

      <section className="mt-8 animate-fade-up" aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="eyebrow text-muted">
          How it works
        </h2>
        <ol className="mt-3 grid grid-cols-3 gap-2">
          {steps.map(({ icon: Icon, title, copy }, index) => (
            <li key={title} className={cardClasses('p-3.5', 'tile')}>
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="text-xs font-extrabold tabular-nums text-gold-700">
                  0{index + 1}
                </span>
              </div>
              <p className="mt-3 text-caption font-bold leading-tight">{title}</p>
              <p className="mt-1 text-xs leading-snug text-muted">{copy}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
