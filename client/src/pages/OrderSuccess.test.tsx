import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '../types/api';
import { ApiError } from '../services/api';
import { documentTitle, getShellConfig } from '../appShell';

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
  store: { id: 's1', name: 'Campus Cafe', slug: 'campus-cafe' },
  items: [],
};
const state = vi.hoisted(() => ({
  order: null as Order | null,
  error: null as ApiError | null,
  isLoading: false,
  retry: vi.fn(),
}));
vi.mock('../features/orders/useOrder', () => ({
  useOrder: () => ({
    order: state.order,
    isLoading: state.isLoading,
    error: state.error,
    retry: state.retry,
  }),
}));
const { OrderSuccessPage } = await import('./OrderSuccess');

function page(passed: Order | null = null) {
  return (
    <MemoryRouter
      initialEntries={[
        { pathname: '/orders/o1/success', state: passed ? { order: passed } : null },
      ]}
    >
      <Routes>
        <Route path="/orders/:id/success" element={<OrderSuccessPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderAt(
  order: Order | null,
  error: ApiError | null,
  isLoading = false,
  passed: Order | null = null,
) {
  state.order = order;
  state.error = error;
  state.isLoading = isLoading;
  return render(page(passed));
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

  // A bogus, stale or foreign link with nothing passed in from checkout: until the server answers, the page cannot know
  // an order exists, and on Slow 4G the celebration showed for a second or more before the 404 replaced it.
  it('shows a neutral loading state, with no celebration, while an order nobody passed in loads', () => {
    renderAt(null, null, true);
    expect(screen.queryByText('Order placed!')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  });

  // The shell titles and announces the route before the page knows whether the order exists, so its title must not
  // claim one was placed; the not-found state then names itself in the tab and has the page's one <h1>.
  it('titles the not-found state truthfully and gives it an h1', () => {
    const shellTitle = document.title;
    const { unmount } = renderAt(null, new ApiError(404, 'NOT_FOUND', 'Order not found.'));
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(/placed/i);
    expect(document.title).toBe(documentTitle('Order not found'));
    expect(getShellConfig('/orders/o1/success').title).not.toMatch(/placed/i);
    unmount();
    expect(document.title).toBe(shellTitle);
  });

  // A retry after "placed, but couldn't load" clears the error while it loads: the page must not drop back to the
  // neutral loading state and replay the whole celebration when the order arrives.
  it('keeps celebrating while a retry after an unreachable server loads', () => {
    const { rerender } = renderAt(
      null,
      new ApiError(0, 'UNREACHABLE', 'Check your connection.'),
      false,
      placed,
    );
    state.error = null;
    state.isLoading = true;
    rerender(page(placed));
    expect(screen.getByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();
  });

  it('keeps "placed, but couldn\'t load" with a retry when the server is unreachable after checkout', () => {
    renderAt(null, new ApiError(0, 'UNREACHABLE', 'Check your connection.'), false, placed);
    expect(screen.getByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();
    expect(
      screen.getByText("Your order was placed, but we couldn't load its details."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('still celebrates a checkout handoff when the refetch fails with a 5xx', () => {
    renderAt(placed, new ApiError(500, 'INTERNAL', 'Server error.'), false, placed);
    expect(screen.getByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();
  });

  // A typed or stale link whose fetch fails (network or 5xx) is no evidence checkout succeeded: a neutral, retryable
  // error, never "Order placed!".
  it.each([
    ['a 5xx', new ApiError(500, 'INTERNAL', 'Server error.')],
    ['a network error', new ApiError(0, 'UNREACHABLE', 'Check your connection.')],
  ])(
    'does not celebrate a direct link when the fetch fails with %s, and offers a retry',
    (_n, err) => {
      state.retry.mockClear();
      renderAt(null, err);
      expect(screen.queryByText('Order placed!')).not.toBeInTheDocument();
      expect(screen.queryByText(/was placed/)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Unable to load your order.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      expect(state.retry).toHaveBeenCalledOnce();
    },
  );
});
