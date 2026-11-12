import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MenuItem, MenuResponse, Order } from '../../types/api';
import { fetchStoreMenu } from '../../services/stores';
import { cartHoldsOtherStore } from '../stores/storeRules';
import { availableQuantity, lineLimit } from './cartRules';
import { selectQuantityOf, useCartStore, type CartStoreRef } from './cartStore';

/** Router-state key under which /cart receives one line per item that could not be added in full. */
const REORDER_NOTICE_STATE = 'reorderNotice';

export function readReorderNotice(state: unknown): string[] {
  if (typeof state !== 'object' || state === null) return [];
  const notice = (state as Record<string, unknown>)[REORDER_NOTICE_STATE];
  return Array.isArray(notice)
    ? notice.filter((line): line is string => typeof line === 'string')
    : [];
}

/**
 * "Order Again": adds the order's items ON TOP of whatever is already in the cart (quantities merge),
 * using the CURRENT menu of the order's store for new lines' prices and every line's stock limit. Existing lines keep
 * their prices. Anything that could not be added in full is reported on the cart page, never silently dropped.
 * A cart that holds another store's items is replaced only after the customer confirms: render `<ReplaceCartSheet {...replace} />` when it is set.
 */
export function useReorder() {
  const navigate = useNavigate();
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  const [asking, setAsking] = useState<Order | null>(null);

  /** `replace`: the customer chose to replace the cart; it is emptied only once the new menu is in hand. */
  async function run(order: Order, replace = false) {
    setReorderingId(order.id);
    let notice: string[];
    try {
      const menu = await fetchStoreMenu(order.store.slug);
      if (replace) useCartStore.getState().clear();
      notice = addOrderToCart(
        order,
        menu.categories.flatMap((category) => category.items),
        menu.rules,
      );
    } catch {
      notice = ["We couldn't load the menu, so nothing was added. Please try again."];
    }
    setReorderingId(null);
    navigate('/cart', { state: notice.length > 0 ? { [REORDER_NOTICE_STATE]: notice } : null });
  }

  function reorder(order: Order) {
    if (cartHoldsOtherStore(useCartStore.getState(), order.store.id)) setAsking(order);
    else void run(order);
  }

  const replace = asking && {
    fromName: useCartStore.getState().storeName ?? 'another store',
    toName: asking.store.name,
    onKeep: () => setAsking(null),
    onReplace: () => {
      setAsking(null);
      void run(asking, true);
    },
  };

  return { reorder, reorderingId, replace };
}

/** Adds the order's items to the cart, each capped by what the menu can sell right now. Returns the shortfalls. */
function addOrderToCart(
  order: Order,
  menuItems: MenuItem[],
  rules: MenuResponse['rules'],
): string[] {
  const store: CartStoreRef = order.store;
  const cart = useCartStore.getState();
  cart.setLimits(rules);
  cart.syncAvailability(menuItems);
  const { limits } = useCartStore.getState();
  const byId = new Map(menuItems.map((item) => [item.id, item]));
  const notice: string[] = [];

  for (const wanted of order.items) {
    const item = byId.get(wanted.menuItemId);
    if (!item) {
      notice.push(`${wanted.name} is no longer on the menu, skipped`);
      continue;
    }
    const available = availableQuantity(item);
    if (available === 0) {
      notice.push(`${item.name} is sold out, skipped`);
      continue;
    }

    const limit = lineLimit(available, limits);
    const inCart = selectQuantityOf(item.id)(useCartStore.getState());
    const added = Math.max(0, Math.min(wanted.quantity, limit - inCart));
    if (added > 0) cart.add(item, added, store);
    if (added < wanted.quantity) {
      const reason =
        available === null ? `max ${limits.maxQuantityPerItem} per order` : `only ${limit} left`;
      notice.push(
        added > 0
          ? `${item.name}: ${reason}, added ${added}`
          : `${item.name}: ${reason}, already in your cart`,
      );
    }
  }
  return notice;
}
