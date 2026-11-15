import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '../../types/api';

// Counts the card's renders through the badge it always draws.
const badgeRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../components/StatusBadge', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../components/StatusBadge')>();
  return {
    ...original,
    StatusBadge: (props: Parameters<typeof original.StatusBadge>[0]) => {
      badgeRenders.count += 1;
      return original.StatusBadge(props);
    },
  };
});
const { StaffOrderCard } = await import('./StaffOrderCard');

const now = new Date().toISOString();
const order = (status: Order['status'] = 'PLACED', updatedAt = now): Order => ({
  id: 'o1',
  orderNumber: 7,
  status,
  paymentStatus: 'PAID',
  total: 120,
  customerName: 'Anu',
  customerPhone: null,
  note: null,
  estimatedReadyAt: now,
  createdAt: now,
  updatedAt,
  store: { id: 's1', name: 'Campus Cafe', slug: 'campus-cafe' },
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
});

describe('StaffOrderCard on a polled board', () => {
  // A scrolled board keeps hundreds of cards mounted; re-rendering each on every poll cost 160-245 ms (/break).
  it('does not re-render for an equal order in new objects, and does for a changed one', () => {
    const onChange = () => {};
    const { rerender } = render(
      <StaffOrderCard order={order()} pending={false} onChangeStatus={onChange} />,
    );
    const first = badgeRenders.count;
    rerender(<StaffOrderCard order={order()} pending={false} onChangeStatus={onChange} />);
    expect(badgeRenders.count).toBe(first);
    rerender(
      <StaffOrderCard
        order={order('PREPARING', new Date(Date.now() + 1000).toISOString())}
        pending={false}
        onChangeStatus={onChange}
      />,
    );
    expect(badgeRenders.count).toBeGreaterThan(first);
  });
});
