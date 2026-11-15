import { useEffect } from 'react';
import { EdgeFades } from '../../components/EdgeFades';
import { cn } from '../../lib/cn';
import { useOverflowEdges } from '../../lib/useOverflowEdges';
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
 * never means scrolling back to the top (except on a short screen, `short:`, where it scrolls away).
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
  const { ref: scroller, edges, onScroll } = useOverflowEdges<HTMLDivElement>();

  // Keep the active chip in view as the page scrolls past sections.
  useEffect(() => {
    const container = scroller.current;
    if (!container || !activeId) return;
    const chip = container.querySelector<HTMLElement>(`[data-chip="${activeId}"]`);
    if (!chip) return;
    const target = chip.offsetLeft - container.clientWidth / 2 + chip.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: scrollBehavior() });
  }, [activeId, scroller]);

  return (
    <div
      className={cn(
        // On a short screen (a phone on its side) it scrolls away with the page instead: pinned, it took a third of
        // the height and, at large text, the bars together left no item on screen.
        'sticky top-14 z-30 -mx-4 mt-3 border-b bg-bg/92 backdrop-blur-md transition-colors duration-150 short:static',
        scrolled ? 'border-line/60' : 'border-transparent',
      )}
    >
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
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
                    ? 'bg-ink-fill text-white'
                    : 'border border-line bg-surface text-muted hover:border-brand-100 hover:bg-brand-50 hover:text-ink',
                )}
              >
                {section.name}
              </button>
            );
          })}
        </div>

        <EdgeFades edges={edges} />
      </div>
    </div>
  );
}
