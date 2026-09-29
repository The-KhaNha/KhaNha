import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { scrollBehavior } from '../../lib/useReducedMotion';

export interface MenuSection {
  id: string;
  name: string;
  isPopular?: boolean;
}

interface CategoryChipsProps {
  sections: MenuSection[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** True once the page has scrolled a little; draws the bar's bottom line. */
  scrolled?: boolean;
}

/**
 * Category bar: sticks under the TopBar for the whole menu, so switching category
 * never means scrolling back to the top.
 *
 * NOTE: its parent must be taller than the bar (ideally the whole page column) or
 * `position: sticky` has no room to travel and the bar scrolls away. See MenuPage.
 *
 * The chips scroll the page to a section rather than swapping panels, so they are
 * toggle buttons, not tabs.
 */
export function CategoryChips({
  sections,
  activeId,
  onSelect,
  scrolled = false,
}: CategoryChipsProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  // Fade the edge that still has chips hidden behind it, so it reads as scrollable.
  const syncOverflow = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflow({ left: el.scrollLeft > 4, right: max > 4 && el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    syncOverflow();
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(el);
    window.addEventListener('resize', syncOverflow);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncOverflow);
    };
  }, [syncOverflow, sections]);

  // Keep the active chip in view as the page scrolls past sections.
  useEffect(() => {
    const container = scroller.current;
    if (!container || !activeId) return;
    const chip = container.querySelector<HTMLElement>(`[data-chip="${activeId}"]`);
    if (!chip) return;
    const target = chip.offsetLeft - container.clientWidth / 2 + chip.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: scrollBehavior() });
  }, [activeId]);

  return (
    <div
      className={cn(
        'sticky top-14 z-30 -mx-4 mt-3 border-b bg-bg/92 backdrop-blur-md transition-colors duration-150',
        scrolled ? 'border-line/60' : 'border-transparent',
      )}
    >
      <div className="relative">
        <div
          ref={scroller}
          onScroll={syncOverflow}
          role="group"
          aria-label="Menu categories"
          className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3"
        >
          {sections.map((section) => {
            const active = section.id === activeId;
            return (
              <button
                key={section.id}
                type="button"
                aria-pressed={active}
                data-chip={section.id}
                onClick={() => onSelect(section.id)}
                className={cn(
                  'inline-flex h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold',
                  'transition-[background-color,color,border-color,scale] duration-150 active:scale-95',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  active
                    ? 'bg-ink text-white'
                    : 'border border-line bg-surface text-muted hover:border-brand-100 hover:bg-brand-50 hover:text-ink',
                )}
              >
                {section.name}
              </button>
            );
          })}
        </div>

        {/* Edge fades: only shown on the side that has more chips. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-bg to-transparent transition-opacity duration-200',
            overflow.left ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-bg to-transparent transition-opacity duration-200',
            overflow.right ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </div>
  );
}
