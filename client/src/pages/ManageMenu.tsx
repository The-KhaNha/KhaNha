import { useState } from 'react';
import { ArrowDown, ArrowUp, Lock, Plus, SearchX, UtensilsCrossed } from 'lucide-react';
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
import { canEditMenu } from '../features/manage/manageRules';
import { canMove, categoryNames, filterItems } from '../features/manage/menuRules';
import { useManageMenu } from '../features/manage/useManageMenu';
import { cn } from '../lib/cn';
import type { ManagedMenuItem, StoreSummary } from '../types/api';

interface ManageMenuTabProps {
  store: Pick<StoreSummary, 'id' | 'slug' | 'brand'>;
}

/** `/manage/:storeSlug/menu`: search, switch, reorder and edit the store's items. */
export function ManageMenuTab({ store }: ManageMenuTabProps) {
  const user = useAuthStore((s) => s.user);
  const allowed = !!user && canEditMenu(user, store);
  const menu = useManageMenu(store, allowed);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // undefined: closed; null: adding; an item: editing it.
  const [editing, setEditing] = useState<ManagedMenuItem | null | undefined>(undefined);

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

      {editing !== undefined && (
        <ItemEditor
          item={editing}
          categories={categories}
          onSave={(input) => menu.save(editing, input)}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
