import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MenuItem, Order } from '../../types/api';
import { fetchMenu } from '../../services/menu';
import { MAX_LINE_QUANTITY, availableQuantity, lineLimit } from './cartRules';
import { selectQuantityOf, useCartStore } from './cartStore';

/** Router-state key under which /cart receives one line per item that could not be added in full. */
const REORDER_NOTICE_STATE = 'reorderNotice';

export function readReorderNotice(state: unknown): string[] {
  if (typeof state !== 'object' || state === null) return [];
  const notice = (state as Record<string, unknown>)[REORDER_NOTICE_STATE];
  return Array.isArray(notice) ? notice.filter((line): line is string => typeof line === 'string') : [];
}

/**
 * "Order Again": adds the order's items ON TOP of whatever is already in the cart (quantities merge),
 * using the CURRENT menu for new lines' prices and every line's stock limit. Existing lines keep their prices.
 * Anything that could not be added in full is reported on the cart page, never silently dropped.
 */
export function useReorder() {
  const navigate = useNavigate();
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  async function reorder(order: Order) {
    setReorderingId(order.id);
    let notice: string[];
    try {
      const menu = await fetchMenu();
      notice = addOrderToCart(order, menu.categories.flatMap((category) => category.items));
    } catch {
      notice = ["We couldn't load the menu, so nothing was added. Please try again."];
    }
    setReorderingId(null);
    navigate('/cart', { state: notice.length > 0 ? { [REORDER_NOTICE_STATE]: notice } : null });
  }

  return { reorder, reorderingId };
}

/** Adds the order's items to the cart, each capped by what the menu can sell right now. Returns the shortfalls. */
function addOrderToCart(order: Order, menuItems: MenuItem[]): string[] {
  const cart = useCartStore.getState();
  cart.syncAvailability(menuItems);
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

    const limit = lineLimit(available);
    const inCart = selectQuantityOf(item.id)(useCartStore.getState());
    const added = Math.max(0, Math.min(wanted.quantity, limit - inCart));
    if (added > 0) cart.add(item, added);
    if (added < wanted.quantity) {
      const reason = available === null ? `max ${MAX_LINE_QUANTITY} per order` : `only ${limit} left`;
      notice.push(added > 0 ? `${item.name}: ${reason}, added ${added}` : `${item.name}: ${reason}, already in your cart`);
    }
  }
  return notice;
}
