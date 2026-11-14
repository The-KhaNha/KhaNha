import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { ApiError } from '../../services/api';
import type { ModifierGroupInput } from '../../services/manageModifiers';
import type { ModifierGroup } from '../../types/api';

interface ModifierGroupEditorProps {
  /** The group to edit; null adds a new one. */
  group: ModifierGroup | null;
  /** Throws an ApiError on refusal; resolving closes the editor. */
  onSave: (input: ModifierGroupInput) => Promise<void>;
  /** Archives the group (old orders keep what they were made with); absent for a new group. */
  onArchive?: () => Promise<void>;
  onClose: () => void;
}

interface OptionRow {
  id?: string;
  /** A stable React key for rows not yet saved. */
  key: string;
  name: string;
  priceDelta: string;
  isDefault: boolean;
  isAvailable: boolean;
}

/** Whole rupees, a leading minus allowed ("Small −₹20"); null for anything else. */
const parseDelta = (text: string): number | null =>
  /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : null;
const parseCount = (text: string): number | null =>
  /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;

let nextKey = 0;
const blankOption = (): OptionRow => ({
  key: `new-${(nextKey += 1)}`,
  name: '',
  priceDelta: '0',
  isDefault: false,
  isAvailable: true,
});

/**
 * One modifier group with its options (P3.2): "Size" (choose 1: Small, Large +₹20), "Add-ons" (up to 3). A sheet on
 * phones, a side panel from `md` (the ItemEditor pattern). The group is saved whole; an option taken out is archived
 * on the server, so old orders keep it. Field errors come from the API's `details.field`.
 */
export function ModifierGroupEditor({
  group,
  onSave,
  onArchive,
  onClose,
}: ModifierGroupEditorProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  const [name, setName] = useState(group?.name ?? '');
  const [minSelect, setMinSelect] = useState(String(group?.minSelect ?? 1));
  const [maxSelect, setMaxSelect] = useState(String(group?.maxSelect ?? 1));
  const [options, setOptions] = useState<OptionRow[]>(
    group
      ? group.options.map((o) => ({ ...o, key: o.id, priceDelta: String(o.priceDelta) }))
      : [blankOption()],
  );
  const [busy, setBusy] = useState<'save' | 'archive' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // A save can outlive the editor (Escape while pending); only a mounted instance may close or set state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setOption = (key: string, change: Partial<OptionRow>) => {
    setOptions((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
    setFieldErrors(({ options: _gone, ...rest }) => rest);
  };

  const run = async (kind: 'save' | 'archive', write: () => Promise<void>) => {
    setBusy(kind);
    setFieldErrors({});
    setFormError(null);
    try {
      await write();
      if (mounted.current) onClose();
    } catch (err) {
      if (!mounted.current) return;
      const field = err instanceof ApiError ? err.details?.field : undefined;
      if (err instanceof ApiError && field) setFieldErrors({ [field]: err.message });
      else
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const min = parseCount(minSelect);
    const max = parseCount(maxSelect);
    if (min === null) return setFieldErrors({ minSelect: 'Enter a whole number.' });
    if (max === null || max < 1) return setFieldErrors({ maxSelect: 'Enter a number from 1.' });
    const deltas = options.map((o) => parseDelta(o.priceDelta));
    if (deltas.some((d) => d === null))
      return setFieldErrors({ options: 'Each price change is whole rupees, like 20 or -10.' });
    void run('save', () =>
      onSave({
        name: name.trim(),
        minSelect: min,
        maxSelect: max,
        options: options.map((o, i) => ({
          ...(o.id ? { id: o.id } : {}),
          name: o.name.trim(),
          priceDelta: deltas[i] ?? 0,
          isDefault: o.isDefault,
          isAvailable: o.isAvailable,
        })),
      }),
    );
  };

  const title = group ? 'Edit choice' : 'New choice';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:justify-end">
      {/* Pointer-only: Escape and the close button are the keyboard ways out. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-overlay/45"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative max-h-[92dvh] w-full animate-sheet-up overflow-y-auto rounded-t-card bg-surface p-5 pb-safe shadow-float outline-none md:max-h-none md:h-full md:max-w-[420px] md:rounded-none"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-title font-extrabold">{title}</h2>
          <IconButton label="Close" icon={<X className="h-5 w-5" />} onClick={onClose} />
        </div>
        <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
          <Input
            label="Name"
            hint="Size, Milk, Add-ons"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fieldErrors.name}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Choose at least"
              inputMode="numeric"
              value={minSelect}
              onChange={(e) => setMinSelect(e.target.value)}
              error={fieldErrors.minSelect}
            />
            <Input
              label="Choose at most"
              inputMode="numeric"
              value={maxSelect}
              onChange={(e) => setMaxSelect(e.target.value)}
              error={fieldErrors.maxSelect}
            />
          </div>
          {/* Under both fields: as an inline hint it wraps at phone width and drops one input below the other. */}
          <p className="-mt-1 text-caption text-muted">0 makes the choice optional.</p>
          <fieldset aria-describedby={fieldErrors.options ? 'options-error' : undefined}>
            <legend className="mb-1.5 text-sm font-semibold text-ink">Options</legend>
            <ul className="space-y-3">
              {options.map((o, i) => (
                <li key={o.key} className="rounded-xl border border-line p-3">
                  <div className="flex items-end gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      label={`Option ${i + 1}`}
                      value={o.name}
                      onChange={(e) => setOption(o.key, { name: e.target.value })}
                    />
                    <Input
                      className="w-24 shrink-0"
                      label="₹ change"
                      inputMode="numeric"
                      value={o.priceDelta}
                      onChange={(e) => setOption(o.key, { priceDelta: e.target.value })}
                    />
                    <IconButton
                      label={`Remove option ${i + 1}`}
                      icon={<Trash2 className="h-4 w-4" />}
                      disabled={options.length === 1}
                      onClick={() => setOptions((rows) => rows.filter((r) => r.key !== o.key))}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-5">
                    <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={o.isDefault}
                        onChange={(e) => setOption(o.key, { isDefault: e.target.checked })}
                        className="h-5 w-5 accent-brand-600"
                      />
                      Default
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={o.isAvailable}
                        onChange={(e) => setOption(o.key, { isAvailable: e.target.checked })}
                        className="h-5 w-5 accent-brand-600"
                      />
                      Available
                    </label>
                  </div>
                </li>
              ))}
            </ul>
            {fieldErrors.options && (
              <p
                id="options-error"
                role="alert"
                className="mt-2 text-caption font-medium text-brand-700"
              >
                {fieldErrors.options}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              className="mt-2"
              onClick={() => setOptions((rows) => [...rows, blankOption()])}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add option
            </Button>
          </fieldset>
          {formError && (
            <p role="alert" className="text-caption font-medium text-brand-700">
              {formError}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={busy === 'save'}
            disabled={busy !== null}
          >
            {group ? 'Save changes' : 'Add choice'}
          </Button>
          {onArchive && (
            <Button
              type="button"
              variant="ghost-danger"
              fullWidth
              loading={busy === 'archive'}
              disabled={busy !== null}
              onClick={() => void run('archive', onArchive)}
            >
              Remove this choice
            </Button>
          )}
        </form>
      </div>
    </div>,
    document.body,
  );
}
