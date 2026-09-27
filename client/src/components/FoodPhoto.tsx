import { forwardRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { photoSrcSet } from '../lib/photo';

interface FoodPhotoProps {
  src: string | null;
  alt?: string;
  /** Size + radius live here (e.g. "h-28 w-28 rounded-[14px]"). */
  className?: string;
  /** Extra classes for the <img> itself (hover scale, zoom-in). */
  imgClassName?: string;
  /** Grey out unavailable items. */
  muted?: boolean;
  eager?: boolean;
  /**
   * Rendered width, so the browser picks the 400px thumbnail or the 900px original (lib/photo.ts). Defaults to a
   * thumbnail; pass the real width for anything larger (the rail, the item sheet).
   */
  sizes?: string;
  /** Only the gold Popular badge is allowed on top of a food photo. */
  children?: ReactNode;
}

/**
 * Every food photo in the app: object-cover, a +6% saturation lift so sauces and crema pop,
 * and a hairline inset ring so pale foods never bleed into white cards.
 * Storefront photos do NOT use this component.
 */
export const FoodPhoto = forwardRef<HTMLSpanElement, FoodPhotoProps>(function FoodPhoto(
  {
    src,
    alt = '',
    className,
    imgClassName,
    muted = false,
    eager = false,
    sizes = '112px',
    children,
  },
  ref,
) {
  return (
    <span
      ref={ref}
      data-food-photo
      className={cn(
        'relative block overflow-hidden bg-surface-2',
        muted && 'opacity-60',
        className,
      )}
    >
      {src && (
        <img
          src={src}
          srcSet={photoSrcSet(src)}
          sizes={sizes}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          className={cn(
            'h-full w-full object-cover saturate-[1.06]',
            muted && 'grayscale',
            imgClassName,
          )}
        />
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(27,20,16,0.06)]"
      />
      {children}
    </span>
  );
});
