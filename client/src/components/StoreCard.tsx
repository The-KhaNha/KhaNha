import { ArrowRight, ChevronRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Store, StoreSummary } from '../types/api';
import { cn } from '../lib/cn';
import { formatPrepRange } from '../lib/format';
import { LCP_IMAGE_PROPS, photoSrcSet } from '../lib/photo';
import { ButtonLink } from './Button';
import { Card, cardClasses } from './Card';
import { OpenPill } from './OpenPill';
import { Skeleton } from './Skeleton';

type StoreCardProps = { className?: string } & (
  | { variant?: 'full'; store: Store }
  // `priority`: the first card on a list, whose photo is the page's largest paint (eager, the rest lazy).
  | { variant: 'compact'; store: StoreSummary; priority?: boolean }
);

/**
 * `full`: the store page's card, over the paprika field so the storefront photo becomes the hunger cue.
 * `compact`: one row of the store list, the whole card a link to the store's page.
 */
export function StoreCard(props: StoreCardProps) {
  if (props.variant === 'compact') {
    const { store, priority = false, className } = props;
    return (
      <Link
        to={`/s/${store.slug}`}
        className={cn(
          cardClasses('flex min-h-11 items-center gap-3 p-3 active:bg-surface-2', 'tile'),
          className,
        )}
      >
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-2">
          {store.imageUrl && (
            <img
              src={store.imageUrl}
              srcSet={photoSrcSet(store.imageUrl)}
              sizes="80px"
              {...(priority ? LCP_IMAGE_PROPS : { loading: 'lazy', decoding: 'async' })}
              alt=""
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-extrabold leading-tight">{store.name}</h3>
          {store.area && <p className="mt-0.5 truncate text-sm text-muted">{store.area}</p>}
          <OpenPill
            state={store.openState}
            label={store.openLabel}
            className="mt-2 border border-line/70"
          />
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      </Link>
    );
  }
  const { store, className } = props;
  return (
    <Card
      as="section"
      padding="none"
      // No entrance fade: the cover is the page's largest paint, which an animating opacity would delay.
      className={cn('overflow-hidden', className)}
    >
      <div className="relative aspect-[16/9] bg-surface-2">
        {store.imageUrl && (
          <img
            src={store.imageUrl}
            srcSet={photoSrcSet(store.imageUrl)}
            sizes="(min-width: 768px) 480px, calc(100vw - 32px)"
            {...LCP_IMAGE_PROPS}
            alt={`${store.name} storefront`}
            className="h-full w-full object-cover"
          />
        )}
        <OpenPill
          state={store.openState}
          label={store.openLabel}
          className="absolute left-4 top-4"
        />
      </div>
      <div className="p-5">
        <h2 className="text-2xl font-extrabold leading-tight">{store.name}</h2>
        <p className="mt-1 text-body text-muted">{store.tagline}</p>
        <div className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-brand-50 pl-1.5 pr-3.5 text-sm font-semibold text-brand-600">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-surface text-brand-600">
            <Clock className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
          </span>
          Ready in {formatPrepRange(store.prepTimeMinMinutes, store.prepTimeMaxMinutes)}
        </div>
        <ButtonLink
          to={`/s/${store.slug}/menu`}
          size="lg"
          fullWidth
          className="mt-5"
          iconRight={<ArrowRight className="h-5 w-5" aria-hidden />}
        >
          View Menu
        </ButtonLink>
      </div>
    </Card>
  );
}

export function StoreCardSkeleton({
  className,
  variant = 'full',
}: {
  className?: string;
  variant?: 'full' | 'compact';
}) {
  if (variant === 'compact') {
    return (
      <Card padding="sm" className={cn('flex items-center gap-3', className)}>
        <Skeleton className="h-20 w-20 shrink-0" />
        <div className="flex-1">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-2 h-4 w-24" />
          <Skeleton className="mt-2 h-6 w-28" round />
        </div>
      </Card>
    );
  }
  return (
    <Card padding="none" className={cn('overflow-hidden', className)}>
      <Skeleton className="aspect-[16/9] w-full rounded-none" />
      <div className="p-5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2.5 h-4 w-56" />
        <Skeleton className="mt-4 h-9 w-44" round />
        <Skeleton className="mt-5 h-14 w-full rounded-control" />
      </div>
    </Card>
  );
}
