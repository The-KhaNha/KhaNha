import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { useResource } from '../../lib/useResource';
import { ApiError } from '../../services/api';
import { fetchManagedMenu } from '../../services/manageMenu';
import { pushTemplate, type PushField } from '../../services/manageStores';
import type { ManagedMenuItem, ManagedStore } from '../../types/api';
import { PUSH_FIELDS, pushPreview } from './pushRules';

interface PushSheetProps {
  brandId: string;
  /** The template item to push. */
  item: ManagedMenuItem;
  /** The brand's branches; only DRAFT and ACTIVE ones can receive a push. */
  branches: ManagedStore[];
  onClose: () => void;
}

const Check = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) => (
  <label className="flex min-h-11 items-center gap-3 text-sm">
    <input
      type="checkbox"
      className="h-5 w-5 accent-brand-600"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    {label}
  </label>
);

const toggle = <T,>(list: T[], value: T, on: boolean) =>
  on ? [...list, value] : list.filter((v) => v !== value);

/**
 * "Push to branches": choose branches and fields, see what each branch's copy (found by lineage) will change, confirm.
 * Stock, availability, order and popularity never move. A sheet on phones, a dialog from `md`.
 */
export function PushSheet({ brandId, item, branches, onClose }: PushSheetProps) {
  const targets = branches.filter((b) => b.status === 'DRAFT' || b.status === 'ACTIVE');
  const [storeIds, setStoreIds] = useState<string[]>(() => targets.map((b) => b.id));
  const [fields, setFields] = useState<PushField[]>(['price']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Every branch's own list, to find its copy: not persisted, and read fresh each time the sheet opens.
  const menus = useResource(
    () => Promise.all(targets.map(async (b) => [b.id, await fetchManagedMenu(b.id)] as const)),
    { key: `manage:push:${item.id}:${targets.map((b) => b.id).join(',')}` },
  );
  const lists = new Map((menus.data ?? []).map(([id, list]) => [id, list] as const));
  const copyIn = (id: string) =>
    lists.get(id)?.find((i) => i.templateItemId === item.id && i.archivedAt === null);
  const sameNameIn = (id: string) =>
    !!lists
      .get(id)
      ?.some(
        (i) =>
          i.archivedAt === null && i.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
      );
  const preview = targets
    .filter((b) => storeIds.includes(b.id))
    .flatMap((b) => pushPreview(item, b.name, copyIn(b.id), fields, sameNameIn(b.id)));

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      setDone(await pushTemplate(brandId, { itemIds: [item.id], storeIds, fields }));
      menus.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-overlay/45"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-title"
        tabIndex={-1}
        className="relative max-h-[90dvh] w-full animate-sheet-up overflow-y-auto rounded-t-card bg-surface p-5 pb-safe shadow-float outline-none md:max-w-[480px] md:animate-scale-in md:rounded-card"
      >
        <h2 id="push-title" className="text-title font-extrabold leading-tight">
          Push “{item.name}” to branches
        </h2>
        {targets.length === 0 ? (
          <p className="mt-3 text-body text-muted">This brand has no branch to push to yet.</p>
        ) : (
          <>
            <fieldset className="mt-4">
              <legend className="text-caption font-semibold text-muted">Branches</legend>
              {targets.map((b) => (
                <Check
                  key={b.id}
                  label={b.status === 'DRAFT' ? `${b.name} (draft)` : b.name}
                  checked={storeIds.includes(b.id)}
                  onChange={(on) => setStoreIds((ids) => toggle(ids, b.id, on))}
                />
              ))}
            </fieldset>
            <fieldset className="mt-3">
              <legend className="text-caption font-semibold text-muted">What to overwrite</legend>
              {PUSH_FIELDS.map(({ key, label }) => (
                <Check
                  key={key}
                  label={label}
                  checked={fields.includes(key)}
                  onChange={(on) => setFields((f) => toggle(f, key, on))}
                />
              ))}
            </fieldset>
            <section
              aria-label="What will change"
              className="mt-3 rounded-control bg-surface-2 p-3 text-sm"
            >
              {menus.isLoading ? (
                <Skeleton className="h-10" />
              ) : !menus.data ? (
                <ErrorState
                  compact
                  title="Couldn't load the branches' menus"
                  message={menus.error?.message}
                  onRetry={menus.reload}
                  unreachable={menus.error?.isUnreachable}
                />
              ) : preview.length === 0 ? (
                <p className="text-muted">Nothing to change: the chosen branches already match.</p>
              ) : (
                <ul className="space-y-1">
                  {preview.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </section>
            <p className="mt-2 text-caption text-muted">
              Stock, on/off and the order of each branch's menu stay as they are.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-brand-700">
            {error}
          </p>
        )}
        {done !== null && (
          <p role="status" className="mt-3 text-sm font-semibold text-success-700">
            {done === 1 ? '1 branch updated.' : `${done} branches updated.`}
          </p>
        )}
        <div className="mt-4 space-y-2 pb-2">
          <Button
            size="lg"
            fullWidth
            loading={busy}
            disabled={
              storeIds.length === 0 || fields.length === 0 || !menus.data || preview.length === 0
            }
            onClick={() => void confirm()}
          >
            Push
          </Button>
          <Button size="lg" fullWidth variant="secondary" onClick={onClose}>
            {done !== null ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
