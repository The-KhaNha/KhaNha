import { Copy, Plus, X } from 'lucide-react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import {
  DAYS,
  MAX_INTERVALS_PER_DAY,
  addInterval,
  canAddInterval,
  timeInputClass,
  copyDayToAll,
  editInterval,
  removeInterval,
  type Week,
} from './hoursRules';

interface WeekGridProps {
  week: Week;
  onChange: (week: Week) => void;
  disabled?: boolean;
}

/** The week's opening hours: a stack of day cards at 360px, one row per day from `md`. */
export function WeekGrid({ week, onChange, disabled = false }: WeekGridProps) {
  return (
    <ul className="space-y-3 md:space-y-0 md:divide-y md:divide-line/70 md:rounded-2xl md:border md:border-line/70 md:bg-surface">
      {DAYS.map(({ day, name }) => {
        const intervals = week[day] ?? [];
        return (
          <li
            key={day}
            aria-label={name}
            className="rounded-2xl border border-line/70 bg-surface p-3 md:grid md:grid-cols-[7rem_1fr_auto] md:items-start md:gap-4 md:rounded-none md:border-0"
          >
            <h3 className="text-sm font-bold md:pt-3">{name}</h3>
            <div className="mt-2 space-y-2 md:mt-0">
              {intervals.length === 0 && <p className="py-2.5 text-sm text-muted">Closed</p>}
              {intervals.map((interval, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="time"
                    aria-label={`${name} opens`}
                    className={timeInputClass}
                    value={interval.opensAt}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(editInterval(week, day, index, { opensAt: e.target.value }))
                    }
                  />
                  <span className="text-muted" aria-hidden>
                    to
                  </span>
                  <input
                    type="time"
                    aria-label={`${name} closes`}
                    className={timeInputClass}
                    value={interval.closesAt}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(editInterval(week, day, index, { closesAt: e.target.value }))
                    }
                  />
                  <IconButton
                    label={`Remove ${name} interval ${index + 1}`}
                    icon={<X className="h-4 w-4" aria-hidden />}
                    disabled={disabled}
                    onClick={() => onChange(removeInterval(week, day, index))}
                  />
                </div>
              ))}
              {intervals.length > 0 && (
                <p className="text-xs text-muted">
                  A closing time before the opening runs past midnight.
                </p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 md:mt-0">
              <Button
                variant="tint"
                iconLeft={<Plus className="h-4 w-4" aria-hidden />}
                disabled={
                  disabled ||
                  intervals.length >= MAX_INTERVALS_PER_DAY ||
                  !canAddInterval(intervals)
                }
                // The visible label comes first, so a voice command of what is on screen matches (WCAG 2.5.3).
                aria-label={`Add hours, ${name}`}
                onClick={() => onChange(addInterval(week, day))}
              >
                Add
              </Button>
              <div className="grow">
                <Button
                  variant="ghost"
                  // Its own line when the row is too narrow (large text), where its label may wrap.
                  fullWidth
                  iconLeft={<Copy className="h-4 w-4" aria-hidden />}
                  disabled={disabled}
                  aria-label={`Copy to all days, ${name}`}
                  onClick={() => onChange(copyDayToAll(week, day))}
                >
                  Copy to all days
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
