import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import type { MenuItem } from '../types/api';
import { ErrorState } from '../components/ErrorState';
import { FoodCard, FoodCardSkeleton } from '../components/FoodCard';
import { OpenPill } from '../components/OpenPill';
import { PopularRail, PopularRailSkeleton } from '../components/PopularRail';
import { Skeleton } from '../components/Skeleton';
import { CategoryChips, type MenuSection } from '../features/menu/CategoryChips';
import { ItemDetailSheet } from '../features/menu/ItemDetailSheet';
import { useMenu } from '../features/menu/useMenu';
import { formatPrepRange } from '../lib/format';
import { photoSrcSet } from '../lib/photo';

interface Section extends MenuSection {
  items: MenuItem[];
}

/** Everything pinned above the menu: TopBar (56px) + category bar (69px) + a gap. */
const STICKY_HEIGHT = 125;
const SCROLL_OFFSET = STICKY_HEIGHT + 14;
const POPULAR_ID = 'popular';

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function MenuPage() {
  const { menu, isLoading, error, retry } = useMenu();
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const closeSheet = useCallback(() => setSelected(null), []);

  const sections = useMemo<Section[]>(() => {
    if (!menu) return [];
    const popular: Section[] = menu.popular.length
      ? [{ id: POPULAR_ID, name: 'Popular', items: menu.popular, isPopular: true }]
      : [];
    return [
      ...popular,
      ...menu.categories.map((c) => ({ id: slugify(c.name), name: c.name, items: c.items })),
    ];
  }, [menu]);

  useEffect(() => {
    if (sections.length === 0) return;
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      // At the very bottom the last section may be too short to reach the offset,
      // so pin it as active instead of leaving the previous chip highlighted.
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 24;
      if (atBottom) {
        setActiveId(sections[sections.length - 1]?.id ?? null);
        return;
      }
      let current = sections[0]?.id ?? null;
      for (const section of sections) {
        const el = document.getElementById(`section-${section.id}`);
        if (el && el.getBoundingClientRect().top - SCROLL_OFFSET <= 1) current = section.id;
      }
      setActiveId(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [sections]);

  function scrollToSection(id: string) {
    const el = document.getElementById(`section-${id}`);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  if (isLoading) return <MenuSkeleton />;

  if (error && !menu) {
    return (
      <ErrorState
        title="Unable to load the menu."
        message={error.message}
        onRetry={retry}
        unreachable={error.isUnreachable}
      />
    );
  }

  if (!menu) return null;
  const { store } = menu;

  return (
    <div className="animate-fade-up">
      {/* The saved menu stays usable when a refresh fails; say so instead of hiding it (checkout re-checks stock). */}
      {error && (
        <ErrorState
          compact
          className="mt-4"
          title="Showing your saved menu"
          message="We couldn't refresh it just now."
          retryLabel="Retry"
          onRetry={retry}
          unreachable={error.isUnreachable}
        />
      )}
      {/* Storefront header: name + tagline live on the photo so food appears sooner. */}
      <section className="pt-4">
        <div className="relative aspect-[21/9] overflow-hidden rounded-[28px] bg-surface-2 shadow-card">
          {store.imageUrl && (
            <img
              src={store.imageUrl}
              srcSet={photoSrcSet(store.imageUrl)}
              sizes="(min-width: 768px) 640px, calc(100vw - 32px)"
              alt=""
              className="h-full w-full object-cover"
            />
          )}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-[72%] store-scrim" />
          <OpenPill isOpen={store.isOpen} className="absolute left-3 top-3" />
          <span className="absolute right-3 top-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-surface/92 px-3 text-[13px] font-semibold text-ink shadow-sm backdrop-blur-md">
            <Clock className="h-4 w-4 text-brand-600" strokeWidth={2.5} aria-hidden />
            {formatPrepRange(store.prepTimeMinMinutes, store.prepTimeMaxMinutes)}
          </span>
          <div className="absolute inset-x-4 bottom-4 text-white">
            <h1 className="text-[26px] font-extrabold leading-[1.15]">{store.name}</h1>
            <p className="mt-0.5 text-[14px] font-semibold text-white">{store.tagline}</p>
          </div>
        </div>
      </section>

      {/* Not wrapped in a div on purpose: a sticky element can only travel inside its
          parent's box, so its parent has to be this full-height page column. */}
      <CategoryChips
        sections={sections}
        activeId={activeId}
        onSelect={scrollToSection}
        scrolled={scrolled}
      />

      {sections.map((section) =>
        section.isPopular ? (
          <PopularRail
            key={section.id}
            id={section.id}
            items={section.items}
            onOpen={setSelected}
          />
        ) : (
          <section
            key={section.id}
            id={`section-${section.id}`}
            aria-labelledby={`heading-${section.id}`}
            className="pt-6"
          >
            <h2 id={`heading-${section.id}`} className="eyebrow mb-3 text-muted">
              {section.name}
            </h2>
            <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
              {section.items.map((item) => (
                <FoodCard key={item.id} item={item} onOpen={setSelected} />
              ))}
            </div>
          </section>
        ),
      )}

      <ItemDetailSheet item={selected} onClose={closeSheet} />
    </div>
  );
}

function MenuSkeleton() {
  return (
    <div className="pt-4" aria-busy aria-label="Loading menu">
      <Skeleton className="aspect-[21/9] w-full rounded-[28px]" />
      <div className="mt-3 flex gap-2 py-3">
        <Skeleton className="h-11 w-20" round />
        <Skeleton className="h-11 w-24" round />
        <Skeleton className="h-11 w-20" round />
        <Skeleton className="h-11 w-28" round />
      </div>
      <PopularRailSkeleton />
      <Skeleton className="mt-6 h-3 w-16" />
      <div className="mt-3 space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
        {Array.from({ length: 4 }, (_, i) => (
          <FoodCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
