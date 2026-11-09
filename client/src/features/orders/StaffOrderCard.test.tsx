import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Order } from '../../types/api';
import { StaffOrderCard } from './StaffOrderCard';

const RLO = '‮';
const now = new Date().toISOString();
const order: Order = {
  id: 'o1',
  orderNumber: 7,
  status: 'PLACED',
  paymentStatus: 'PAID',
  total: 120,
  customerName: `Anu${RLO}evil`,
  customerPhone: '9876543210',
  note: `Less sugar${RLO}gnirts`,
  estimatedReadyAt: now,
  createdAt: now,
  updatedAt: now,
  store: { id: 's1', name: 'Campus Cafe' },
  items: [
    {
      id: 'l1',
      menuItemId: 'i1',
      name: 'Cold Coffee',
      unitPrice: 120,
      quantity: 1,
      lineTotal: 120,
    },
  ],
};

describe('StaffOrderCard', () => {
  // A direction override (U+202E) in the name would otherwise reverse the phone shown after it.
  it('isolates customer-typed text in <bdi>, with the phone outside it', () => {
    const { container } = render(
      <StaffOrderCard order={order} pending={false} onChangeStatus={() => {}} />,
    );
    const isolated = [...container.querySelectorAll('bdi')].map((el) => el.textContent);
    expect(isolated).toEqual([order.customerName, order.note]);
    expect(screen.getByText(/9876543210/).closest('bdi')).toBeNull();
  });
});
