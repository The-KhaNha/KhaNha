import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, X } from 'lucide-react';
import { Button } from '../../components/Button';
import { VALIDATION } from '../config/fallbacks';
import { FoodPhoto } from '../../components/FoodPhoto';
import { IconButton } from '../../components/IconButton';
import { Input, Textarea } from '../../components/Input';
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { ApiError } from '../../services/api';
import type { MenuItemInput } from '../../services/manageMenu';
import type { Diet, ManagedMenuItem, ModifierGroup } from '../../types/api';
import { usePhotoUpload, type PhotoUploadStatus } from './usePhotoUpload';

interface ItemEditorProps {
  /** The store the item belongs to: its photo is uploaded there. */
  storeId: string;
  /** The item to edit; null adds a new one. */
  item: ManagedMenuItem | null;
  /** The store's categories, offered while typing; a new name is allowed. */
  categories: string[];
  /** Throws an ApiError on refusal; resolving closes the editor. `groupIds`: the item's choices, in order. */
  onSave: (input: MenuItemInput, groupIds: string[]) => Promise<void>;
  onClose: () => void;
  /** The store's choices (P3.2) the item may offer; none hides the field. */
  modifierGroups?: ModifierGroup[];
  /** The ones the item offers now. */
  groupIds?: string[];
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

const PHOTO_STEPS: Partial<Record<PhotoUploadStatus, string>> = {
  preparing: 'Preparing the photo…',
  sending: 'Sending the photo…',
  processing: 'Making it ready for the menu…',
  ready: 'New photo ready. Save to use it.',
};
const PHOTO_BUSY: PhotoUploadStatus[] = ['preparing', 'sending', 'processing'];

/**
 * The item form: a bottom sheet on phones, a side panel from `md` (the ItemDetailSheet pattern). Field errors come
 * from the API's `details.field`; any other refusal shows under the buttons. A new photo goes up as soon as it is
 * chosen (usePhotoUpload); saving attaches it once it is processed.
 */
export function ItemEditor({
  storeId,
  item,
  categories,
  onSave,
  onClose,
  modifierGroups = [],
  groupIds = [],
}: ItemEditorProps) {
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
  const [chosenGroups, setChosenGroups] = useState<string[]>(groupIds);
  const photo = usePhotoUpload(storeId);
  const photoBusy = PHOTO_BUSY.includes(photo.status);
  // The item's photo was taken off (saved as imageUploadId: null).
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // What a save would keep: the new photo once it is going up or ready; otherwise the item's own, unless removed. A
  // failed upload shows what stays (its error says why).
  const newPhoto = photoBusy || photo.status === 'ready';
  const shownPhoto = newPhoto ? photo.preview : photoRemoved ? null : (item?.imageUrl ?? null);
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
      // In the store's order, so the item offers them as the choices list shows them.
      const orderedGroups = modifierGroups
        .map((g) => g.id)
        .filter((id) => chosenGroups.includes(id));
      await onSave(
        {
          name: form.name.trim(),
          description: form.description.trim(),
          price,
          category: form.category.trim(),
          diet: form.diet,
          isPopular: form.isPopular,
          ...(photo.uploadId
            ? { imageUploadId: photo.uploadId }
            : photoRemoved
              ? { imageUploadId: null }
              : {}),
        },
        orderedGroups,
      );
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
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-ink">Photo</legend>
            <div className="flex items-start gap-3">
              <FoodPhoto
                src={shownPhoto}
                srcSet={newPhoto ? null : item?.imageSrcSet}
                alt=""
                className="h-24 w-24 shrink-0 rounded-control"
                sizes="96px"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <p aria-live="polite" className="text-caption text-muted">
                  {photo.status === 'failed' ? null : PHOTO_STEPS[photo.status]}
                </p>
                {photo.error && (
                  <p role="alert" className="text-caption font-medium text-brand-700">
                    {photo.error}
                  </p>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    e.target.value = '';
                    if (!chosen) return;
                    void photo.upload(chosen);
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  {photoBusy ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={photo.cancel}
                    >
                      Cancel upload
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => fileInput.current?.click()}
                    >
                      <ImagePlus className="h-4 w-4" aria-hidden />
                      {shownPhoto ? 'Change photo' : 'Add photo'}
                    </Button>
                  )}
                  {photo.status === 'failed' && (
                    <Button type="button" variant="tint" disabled={busy} onClick={photo.retry}>
                      Try again
                    </Button>
                  )}
                  {!photoBusy && shownPhoto && (
                    <Button
                      type="button"
                      variant="ghost-danger"
                      disabled={busy}
                      onClick={() => {
                        photo.cancel();
                        setPhotoRemoved(Boolean(item?.imageUrl));
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </fieldset>
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
          {modifierGroups.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-ink">Choices</legend>
              {modifierGroups.map((g) => (
                <label
                  key={g.id}
                  className="flex min-h-11 items-center gap-3 text-sm font-semibold"
                >
                  <input
                    type="checkbox"
                    checked={chosenGroups.includes(g.id)}
                    onChange={(e) =>
                      setChosenGroups((ids) =>
                        e.target.checked ? [...ids, g.id] : ids.filter((id) => id !== g.id),
                      )
                    }
                    className="h-5 w-5 accent-brand-600"
                  />
                  {g.name}
                </label>
              ))}
            </fieldset>
          )}
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
          <Button type="submit" size="lg" fullWidth loading={busy} disabled={photoBusy}>
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
