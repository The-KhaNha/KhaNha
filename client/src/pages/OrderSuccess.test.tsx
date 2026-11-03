import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '../types/api';
import { ApiError } from '../services/api';

const now = new Date().toISOString();
const placed: Order = {
  id: 'o1',
  orderNumber: 1042,
  status: 'PLACED',
  paymentStatus: 'PAID',
  total: 240,
  customerName: 'Anishka',
  customerPhone: null,
  note: null,
  estimatedReadyAt: now,
  createdAt: now,
  updatedAt: now,
  store: { id: 's1', name: 'Campus Cafe' },
  items: [],
};
const state = vi.hoisted(() => ({
  order: null as Order | null,
  error: null as ApiError | null,
}));
vi.mock('../features/orders/useOrder', () => ({
  useOrder: () => ({ order: state.order, isLoading: false, error: state.error, retry: () => {} }),
}));
const { OrderSuccessPage } = await import('./OrderSuccess');

function renderAt(order: Order | null, error: ApiError | null) {
  state.order = order;
  state.error = error;
  render(
    <MemoryRouter initialEntries={['/orders/o1/success']}>
      <Routes>
        <Route path="/orders/:id/success" element={<OrderSuccessPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrderSuccessPage', () => {
  it('celebrates a loaded order', () => {
    renderAt(placed, null);
    expect(screen.getByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();
    expect(screen.getByText('#1042')).toBeInTheDocument();
  });

  // A typed, stale or someone else's id is a 404: claiming "Order placed!" for it, with a retry that can only 404
  // again, told the visitor an order existed that never did.
  it('says the order was not found on a 404, with no celebration and no retry', () => {
    renderAt(null, new ApiError(404, 'NOT_FOUND', 'Order not found.'));
    expect(screen.queryByText('Order placed!')).not.toBeInTheDocument();
    expect(screen.queryByText(/was placed/)).not.toBeInTheDocument();
    expect(screen.getByText("We couldn't find this order.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View your orders' })).toHaveAttribute(
      'href',
      '/orders',
    );
  });

  it('keeps "placed, but couldn\'t load" with a retry when the server is unreachable', () => {
    renderAt(null, new ApiError(0, 'UNREACHABLE', 'Check your connection.'));
    expect(screen.getByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();
    expect(
      screen.getByText("Your order was placed, but we couldn't load its details."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });
});
