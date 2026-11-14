import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Lock,
  Plus,
  SearchX,
  Send,
  UtensilsCrossed,
} from 'lucide-react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { IconButton } from '../components/IconButton';
import { Input } from '../components/Input';
import { Price } from '../components/Price';
import { Skeleton } from '../components/Skeleton';
import { Switch } from '../components/Switch';
import { useAuthStore } from '../features/auth/authStore';
import { ItemEditor } from '../features/manage/ItemEditor';
import { ModifierGroupEditor } from '../features/manage/ModifierGroupEditor';
import { useModifierGroups } from '../features/manage/useModifierGroups';
import { PushSheet } from '../features/manage/PushSheet';
import { useMyBrands } from '../features/manage/useManage';
import { canEditMenu } from '../features/manage/manageRules';
import { canMove, categoryNames, filterItems } from '../features/manage/menuRules';
import { useManageMenu } from '../features/manage/useManageMenu';
import { cn } from '../lib/cn';
import type { ManagedMenuItem, ModifierGroup, StoreSummary } from '../types/api';

interface ManageMenuTabProps {
  store: Pick<StoreSummary, 'id' | 'slug' | 'brand'> & { isTemplate?: boolean };
  /** After every write: the shell reloads the store's go-live checklist. */
  onChanged?: () => void;
}

/** `/manage/:storeSlug/menu`: search, switch, reorder and edit the store's items. */
export function ManageMenuTab({ store, onChanged }: ManageMenuTabProps) {
  const user = useAuthStore((s) => s.user);
  const allowed = !!user && canEditMenu(user, store);
  const menu = useManageMenu(store, allowed, onChanged);
  const modifiers = useModifierGroups(store, allowed);
  // undefined: closed; null: adding; a group: editing it.
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // undefined: closed; null: adding; an item: editing it.
  const [editing, setEditing] = useState<ManagedMenuItem | null | undefined>(undefined);
  // On a brand template: the item being pushed to the branches, and the branches (the owner's brands).
  const [pushing, setPushing] = useState<ManagedMenuItem | null>(null);
  const brands = useMyBrands(!!store.isTemplate);
  // null while the brands load: the sheet shows that, and an error with a retry, rather than "no branches".
  const branches = brands.data
    ? (brands.data.find((b) => b.id === store.brand.id)?.stores ?? [])
    : null;

  if (!allowed)
    return (
      <EmptyState
        icon={Lock}
        tone="neutral"
        title="Only the store's manager or owner can edit the menu"
        description="You can open this store's management as an admin, but the menu is theirs to change."
      />
    );
  if (menu.error && !menu.items)
    return (
      <ErrorState
        compact
        title="Unable to load the menu."
        message={menu.error.message}
        onRetry={menu.retry}
        unreachable={menu.error.isUnreachable}
      />
    );
  if (!menu.items || menu.isLoading)
    return (
      <div className="space-y-3 pt-4" aria-busy aria-label="Loading the menu">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );

  const categories = categoryNames(menu.items);
  const shown = filterItems(menu.items, query, category);
  const listLocked = !!menu.listBusy || menu.pendingIds.size > 0;
  const filtering = query.trim() !== '' || category !== null;

  return (
    <div className="pt-4">
      {menu.error && (
        <ErrorState
          compact
          className="mb-3"
          title="Showing the saved menu"
          message="We couldn't refresh it just now."
          retryLabel="Retry"
          onRetry={menu.retry}
          unreachable={menu.error.isUnreachable}
        />
      )}
      <div className="flex items-end gap-2">
        <Input
          className="min-w-0 flex-1"
          label="Search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button onClick={() => setEditing(null)}>
          <Plus className="h-4 w-4" aria-hidden />
          Add item
        </Button>
      </div>
      {categories.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Category">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? 'all'}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                'min-h-11 rounded-control border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                category === c
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-line text-muted',
              )}
            >
              {c ?? 'All'}
            </button>
          ))}
        </div>
      )}
      {category && (
        <Button
          variant="ghost-danger"
          className="mt-2"
          loading={menu.listBusy === 'soldOut'}
          disabled={listLocked}
          onClick={() => menu.soldOutCategory(category)}
        >
          Sold out: this category
        </Button>
      )}
      {menu.writeError && (
        <p role="alert" className="mt-3 text-caption font-medium text-brand-700">
          {menu.writeError}
        </p>
      )}

      {menu.items.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="No items yet"
          description="Add the first item and customers see it on the menu."
        />
      ) : shown.length === 0 ? (
        <EmptyState icon={SearchX} tone="neutral" title="No item matches" />
      ) : (
        <ul className="mt-3 divide-y divide-line/70">
          {shown.map((item) => (
            <li key={item.id} className="flex items-center gap-1 py-2">
              <button
                type="button"
                onClick={() => setEditing(item)}
                className="min-h-11 min-w-0 flex-1 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span className="block truncate font-semibold">{item.name}</span>
                <span className="block truncate text-caption text-muted">
                  {item.category} · <Price value={item.price} />
                  {item.isEnabled && !item.isAvailable && (
                    <span className="font-semibold text-brand-700"> · Sold out</span>
                  )}
                </span>
              </button>
              {/* Reordering inside a filter would move items past ones that are hidden: only the full list. */}
              {!filtering && (
                <>
                  <IconButton
                    label={`Move ${item.name} up`}
                    icon={<ArrowUp className="h-4 w-4" />}
                    disabled={listLocked || !canMove(menu.items!, item.id, -1)}
                    onClick={() => menu.move(item.id, -1)}
                  />
                  <IconButton
                    label={`Move ${item.name} down`}
                    icon={<ArrowDown className="h-4 w-4" />}
                    disabled={listLocked || !canMove(menu.items!, item.id, 1)}
                    onClick={() => menu.move(item.id, 1)}
                  />
                </>
              )}
              {store.isTemplate && (
                <IconButton
                  label={`Push ${item.name} to branches`}
                  icon={<Send className="h-4 w-4" />}
                  onClick={() => setPushing(item)}
                />
              )}
              <Switch
                checked={item.isEnabled}
                label={`${item.name} on the menu`}
                disabled={!!menu.listBusy || menu.pendingIds.has(item.id)}
                onChange={() => menu.toggle(item)}
              />
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="choices-heading" className="mt-6 border-t border-line/70 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 id="choices-heading" className="font-bold">
              Choices
            </h2>
            <p className="text-caption text-muted">
              Size, milk, add-ons: offered on the items you pick.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setEditingGroup(null)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add choice
          </Button>
        </div>
        {modifiers.error && !modifiers.groups ? (
          <ErrorState
            compact
            className="mt-3"
            title="Unable to load the choices."
            message={modifiers.error.message}
            onRetry={modifiers.retry}
            unreachable={modifiers.error.isUnreachable}
          />
        ) : !modifiers.groups ? (
          <Skeleton className="mt-3 h-12" />
        ) : modifiers.groups.length > 0 ? (
          <ul className="mt-2 divide-y divide-line/70">
            {modifiers.groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setEditingGroup(g)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-control py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{g.name}</span>
                    <span className="block truncate text-caption text-muted">
                      {g.options.map((o) => o.name).join(', ')}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {pushing && (
        <PushSheet
          brandId={store.brand.id}
          item={pushing}
          branches={branches}
          branchesError={brands.error}
          onRetryBranches={brands.reload}
          onClose={() => setPushing(null)}
        />
      )}
      {editing !== undefined && (
        <ItemEditor
          storeId={store.id}
          item={editing}
          categories={categories}
          modifierGroups={modifiers.groups ?? []}
          groupIds={editing ? (modifiers.itemGroupIds[editing.id] ?? []) : []}
          onSave={async (input, groupIds) => {
            const saved = await menu.save(editing, input);
            const before = editing ? (modifiers.itemGroupIds[editing.id] ?? []) : [];
            if (groupIds.join() !== before.join())
              await modifiers.setItemGroups(saved.id, groupIds);
          }}
          onClose={() => setEditing(undefined)}
        />
      )}
      {editingGroup !== undefined && (
        <ModifierGroupEditor
          group={editingGroup}
          onSave={(input) => modifiers.save(editingGroup?.id ?? null, input)}
          onArchive={editingGroup ? () => modifiers.archive(editingGroup.id) : undefined}
          onClose={() => setEditingGroup(undefined)}
        />
      )}
    </div>
  );
}
