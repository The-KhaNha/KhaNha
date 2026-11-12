import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import type { NewException } from '../../services/stores';
import type { ScheduleException } from '../../types/api';
import { PRESETS, localToday, presetDraft, timeInputClass } from './hoursRules';

const range = (e: ScheduleException) =>
  e.startsOn === e.endsOn ? e.startsOn : `${e.startsOn} to ${e.endsOn}`;

interface ExceptionListProps {
  exceptions: ScheduleException[];
  /** Resolves with the server's message when the add was refused, else null. */
  onAdd: (draft: NewException) => Promise<string | null>;
  onRemove: (id: string) => void;
  busy: boolean;
}

/** The special days: closures and one-off hours, each added from a preset and removable. */
export function ExceptionList({ exceptions, onAdd, onRemove, busy }: ExceptionListProps) {
  const [draft, setDraft] = useState<NewException | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<NewException>) => setDraft((d) => d && { ...d, ...p });

  const add = async () => {
    if (!draft) return;
    const message = await onAdd(draft);
    setError(message);
    if (!message) setDraft(null);
  };

  return (
    <section aria-labelledby="special-days" className="mt-8">
      <h2 id="special-days" className="text-lg font-extrabold">
        Special days
      </h2>
      {exceptions.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No special days coming up.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {exceptions.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-2xl border border-line/70 bg-surface p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{e.label}</p>
                <p className="text-sm text-muted">
                  {range(e)} ·{' '}
                  {e.kind === 'CLOSED' ? 'Closed' : `Open ${e.opensAt} to ${e.closesAt}`}
                </p>
              </div>
              <IconButton
                label={`Remove ${e.label}`}
                icon={<Trash2 className="h-4 w-4" aria-hidden />}
                disabled={busy}
                onClick={() => onRemove(e.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map(({ id, label }) => (
          <Button
            key={id}
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setDraft(presetDraft(id, localToday()));
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      {draft && (
        <form
          className="mt-3 space-y-3 rounded-2xl border border-line/70 bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            label="Label"
            value={draft.label}
            minLength={2}
            maxLength={60}
            required
            onChange={(e) => patch({ label: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="From"
              type="date"
              value={draft.startsOn}
              required
              onChange={(e) =>
                patch({
                  startsOn: e.target.value,
                  endsOn: e.target.value > draft.endsOn ? e.target.value : draft.endsOn,
                })
              }
            />
            <Input
              label="To"
              type="date"
              value={draft.endsOn}
              min={draft.startsOn}
              required
              onChange={(e) => patch({ endsOn: e.target.value })}
            />
          </div>
          {draft.kind === 'SPECIAL_HOURS' && (
            <div className="flex items-center gap-2">
              <input
                type="time"
                aria-label="Special hours open"
                className={timeInputClass}
                value={draft.opensAt ?? ''}
                required
                onChange={(e) => patch({ opensAt: e.target.value })}
              />
              <span className="text-muted" aria-hidden>
                to
              </span>
              <input
                type="time"
                aria-label="Special hours close"
                className={timeInputClass}
                value={draft.closesAt ?? ''}
                required
                onChange={(e) => patch({ closesAt: e.target.value })}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-caption font-medium text-brand-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Add special day
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
