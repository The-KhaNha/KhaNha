import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Order } from '../../types/api';
import { StaffBoard } from './StaffBoard';
import { STAFF_FILTERS } from './orderStatus';

const now = new Date().toISOString();
const order = (n: number): Order => ({
  id: `o${n}`,
  orderNumber: n,
  status: 'PLACED',
  paymentStatus: 'PAID',
  total: 120,
  customerName: `Customer ${n}`,
  customerPhone: null,
  note: null,
  estimatedReadyAt: now,
  createdAt: now,
  updatedAt: now,
  store: { id: 's1', name: 'Campus Cafe', slug: 'campus-cafe' },
  items: [
    {
      id: `l${n}`,
      menuItemId: 'i1',
      name: 'Cold Coffee',
      unitPrice: 120,
      quantity: 1,
      lineTotal: 120,
    },
  ],
});

const board = (visible: Order[]) => (
  <StaffBoard
    orders={visible}
    visible={visible}
    isLoading={false}
    error={null}
    filter={STAFF_FILTERS[0]!}
    pendingIds={new Set()}
    actionErrors={{}}
    freshIds={new Set()}
    leavingIds={new Set()}
    onRetry={() => {}}
    onShowAll={() => {}}
    onChangeStatus={() => {}}
  />
);

describe('StaffBoard', () => {
  // Cards once sat in groups of 12: when an order before it left, the 13th moved to another group's parent and was
  // remounted, dropping an open "Cancel order" confirmation (CodeRabbit on #123).
  it("keeps a card's open cancel confirmation when orders before it leave the board", () => {
    const orders = Array.from({ length: 13 }, (_, i) => order(i + 1));
    const { rerender } = render(board(orders));
    const last = () => screen.getByText('Customer 13').closest('article')!;
    fireEvent.click(within(last()).getByRole('button', { name: /Cancel order/ }));
    expect(within(last()).getByRole('button', { name: /Yes, cancel order/ })).toBeInTheDocument();
    rerender(board(orders.slice(1)));
    expect(within(last()).getByRole('button', { name: /Yes, cancel order/ })).toBeInTheDocument();
  });
});
