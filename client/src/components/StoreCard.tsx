import { ArrowRight, Clock } from 'lucide-react';
import type { Store } from '../types/api';
import { cn } from '../lib/cn';
import { formatPrepRange } from '../lib/format';
import { LCP_IMAGE_PROPS, photoSrcSet } from '../lib/photo';
import { ButtonLink } from './Button';
import { Card } from './Card';
import { OpenPill } from './OpenPill';
import { Skeleton } from './Skeleton';

interface StoreCardProps {
  store: Store;
  className?: string;
}

/** Home store card. Sits over the paprika field so the storefront photo becomes the hunger cue. */
export function StoreCard({ store, className }: StoreCardProps) {
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
        <OpenPill isOpen={store.isOpen} className="absolute left-4 top-4" />
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
          to="/menu"
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

export function StoreCardSkeleton({ className }: { className?: string }) {
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
