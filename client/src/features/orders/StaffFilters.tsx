import { EdgeFades } from '../../components/EdgeFades';
import { cn } from '../../lib/cn';
import { useOverflowEdges } from '../../lib/useOverflowEdges';
import { STAFF_FILTERS, type StaffFilterKey } from './orderStatus';

interface StaffFiltersProps {
  value: StaffFilterKey;
  counts: Record<StaffFilterKey, number>;
  onChange: (key: StaffFilterKey) => void;
}

/** Status filters for the board. They narrow one list rather than switch panels, so: toggle buttons, not tabs. */
export function StaffFilters({ value, counts, onChange }: StaffFiltersProps) {
  const { ref, edges, onScroll } = useOverflowEdges<HTMLDivElement>();
  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={onScroll}
        role="group"
        aria-label="Filter orders"
        className="no-scrollbar -mb-px flex gap-1 overflow-x-auto"
      >
        {STAFF_FILTERS.map((f) => {
          const active = f.key === value;
          const count = counts[f.key];
          const hot = f.key === 'NEW' && count > 0;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(f.key)}
              className={cn(
                'relative flex h-12 shrink-0 items-center gap-2 px-3 text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                active ? 'text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {f.label}
              <span
                key={count}
                className={cn(
                  'rounded-full px-2 py-0.5 text-2xs font-bold tabular-nums transition-colors duration-200 animate-pop',
                  hot
                    ? 'bg-brand-500 text-white'
                    : active
                      ? 'bg-surface-2 text-ink'
                      : 'bg-surface-2 text-muted',
                )}
              >
                {count}
              </span>
              {active && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-500" />
              )}
            </button>
          );
        })}
      </div>
      {/* "Ready" and "Done" hide past the edge at 360px: the fade says there is more. */}
      <EdgeFades edges={edges} />
    </div>
  );
}
