import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '../../components/Button';
import { VALIDATION } from '../config/fallbacks';
import { FoodPhoto } from '../../components/FoodPhoto';
import { IconButton } from '../../components/IconButton';
import { Input, Textarea } from '../../components/Input';
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { ApiError } from '../../services/api';
import type { MenuItemInput } from '../../services/manageMenu';
import type { Diet, ManagedMenuItem } from '../../types/api';

interface ItemEditorProps {
  /** The item to edit; null adds a new one. */
  item: ManagedMenuItem | null;
  /** The store's categories, offered while typing; a new name is allowed. */
  categories: string[];
  /** Throws an ApiError on refusal; resolving closes the editor. */
  onSave: (input: MenuItemInput) => Promise<void>;
  onClose: () => void;
}

const { nameMax, descriptionMax, categoryMax } = VALIDATION.menuItem;

const DIETS: { value: Diet | null; label: string }[] = [
  { value: null, label: 'Not marked' },
  { value: 'VEG', label: 'Veg' },
  { value: 'EGG', label: 'Egg' },
  { value: 'NON_VEG', label: 'Non-veg' },
];

/** Whole rupees only, as the API wants; null for anything else so the form says so before the round-trip. */
const parsePrice = (text: string): number | null =>
  /^\d+$/.test(text.trim()) ? Number(text) : null;

/**
 * The item form: a bottom sheet on phones, a side panel from `md` (the ItemDetailSheet pattern). Field errors come
 * from the API's `details.field`; any other refusal shows under the buttons. Photo upload arrives with P3 PR 11.
 */
export function ItemEditor({ item, categories, onSave, onClose }: ItemEditorProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useFocusTrap(dialogRef, true);
  const [form, setForm] = useState({
    name: item?.name ?? '',
    description: item?.description ?? '',
    price: item ? String(item.price) : '',
    category: item?.category ?? '',
    diet: item?.diet ?? null,
    isPopular: item?.isPopular ?? false,
  });
  const [busy, setBusy] = useState(false);
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

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors(({ [key]: _gone, ...rest }) => rest);
    setFormError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const price = parsePrice(form.price);
    if (price === null) return setFieldErrors({ price: 'Enter the price in whole rupees.' });
    setBusy(true);
    setFieldErrors({});
    setFormError(null);
    try {
      await onSave({
        name: form.name.trim(),
        description: form.description.trim(),
        price,
        category: form.category.trim(),
        diet: form.diet,
        isPopular: form.isPopular,
      });
      if (mounted.current) onClose();
    } catch (err) {
      if (!mounted.current) return;
      const field = err instanceof ApiError ? err.details?.field : undefined;
      if (err instanceof ApiError && field) setFieldErrors({ [field]: err.message });
      else
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      setBusy(false);
    }
  };

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
        aria-label={item ? 'Edit item' : 'Add item'}
        tabIndex={-1}
        className="relative max-h-[92dvh] w-full animate-sheet-up overflow-y-auto rounded-t-card bg-surface p-5 pb-safe shadow-float outline-none md:max-h-none md:h-full md:max-w-[420px] md:rounded-none"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-title font-extrabold">{item ? 'Edit item' : 'Add item'}</h2>
          <IconButton label="Close" icon={<X className="h-5 w-5" />} onClick={onClose} />
        </div>
        <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
          {item?.imageUrl && (
            <FoodPhoto src={item.imageUrl} alt="" className="h-28 w-28 rounded-control" />
          )}
          <Input
            label="Name"
            value={form.name}
            maxLength={nameMax}
            error={fieldErrors.name}
            onChange={(e) => set('name', e.target.value)}
            data-autofocus
          />
          <Textarea
            label="Description"
            hint="Optional"
            value={form.description}
            maxLength={descriptionMax}
            error={fieldErrors.description}
            onChange={(e) => set('description', e.target.value)}
          />
          <Input
            label="Price (₹)"
            inputMode="numeric"
            value={form.price}
            error={fieldErrors.price}
            onChange={(e) => set('price', e.target.value)}
          />
          <Input
            label="Category"
            hint="Pick one or type a new one"
            list={listId}
            value={form.category}
            maxLength={categoryMax}
            error={fieldErrors.category}
            onChange={(e) => set('category', e.target.value)}
          />
          <datalist id={listId}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-ink">Diet</legend>
            <div className="flex flex-wrap gap-2">
              {DIETS.map(({ value, label }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={form.diet === value}
                  onClick={() => set('diet', value)}
                  className={cn(
                    'min-h-11 rounded-control border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    form.diet === value
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-line bg-surface text-muted',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={form.isPopular}
              onChange={(e) => set('isPopular', e.target.checked)}
              className="h-5 w-5 accent-brand-600"
            />
            Show as popular
          </label>
          {formError && (
            <p role="alert" className="text-caption font-medium text-brand-700">
              {formError}
            </p>
          )}
          <Button type="submit" size="lg" fullWidth loading={busy}>
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
