import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Order, OrderStatus } from '../types/api';

const now = new Date().toISOString();
const order = (status: OrderStatus): Order => ({
  id: 'o1',
  orderNumber: 1042,
  status,
  paymentStatus: 'PAID',
  total: 240,
  customerName: 'Anishka',
  customerPhone: null,
  note: null,
  estimatedReadyAt: now,
  createdAt: now,
  updatedAt: now,
  store: { id: 's1', name: 'Campus Cafe', slug: 'campus-cafe' },
  items: [
    {
      id: 'l1',
      menuItemId: 'i1',
      name: 'Cold Coffee',
      unitPrice: 120,
      quantity: 2,
      lineTotal: 240,
    },
  ],
});
const state = vi.hoisted(() => ({ order: null as Order | null }));
vi.mock('../features/orders/useOrder', () => ({
  useOrder: () => ({ order: state.order, isLoading: false, error: null, retry: () => {} }),
}));
vi.mock('../features/cart/useReorder', () => ({
  useReorder: () => ({ reorder: () => {}, reorderingId: null }),
}));
const { OrderPage } = await import('./Order');

const page = () => (
  <MemoryRouter>
    <OrderPage />
  </MemoryRouter>
);
const heroEnters = (container: HTMLElement) =>
  !!container.querySelector('section')?.closest('.animate-scale-in');

describe('OrderPage hero entrance', () => {
  // The hero is the page's largest paint: inside an opacity-0 entrance Chrome counts it only at its next repaint
  // (seconds later, or never), so the status the page opened on shows at once (e2e "largest paint is its hero").
  it('shows the first status without an entrance, and scales in a status a poll brings', () => {
    state.order = order('PLACED');
    const { container, rerender } = render(page());
    expect(heroEnters(container)).toBe(false);
    rerender(page());
    expect(heroEnters(container)).toBe(false);

    state.order = order('PREPARING');
    rerender(page());
    expect(heroEnters(container)).toBe(true);
  });
});
