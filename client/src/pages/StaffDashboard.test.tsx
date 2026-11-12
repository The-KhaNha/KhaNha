import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has none; the filter row's edge fades use it.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const boardRenders = vi.hoisted(() => ({ count: 0 }));
// Stable, as useResource's data is: a new array every render would read as a new poll.
const noOrders = vi.hoisted(() => [] as never[]);
const updatedAt = vi.hoisted(() => Date.now());
vi.mock('../features/orders/StaffBoard', () => ({
  StaffBoard: () => {
    boardRenders.count += 1;
    return null;
  },
}));
const ordersFor = vi.hoisted(() => vi.fn());
vi.mock('../features/orders/useOrders', () => ({
  useOrders: (options: unknown) => {
    ordersFor(options);
    return {
      orders: noOrders,
      isLoading: false,
      error: null,
      retry: () => {},
      mutate: () => {},
      updatedAt,
    };
  },
}));
vi.mock('../features/stores/useStores', () => ({
  useStoreByRef: () => ({ store: undefined, mutate: () => {} }),
}));
const { useAuthStore } = await import('../features/auth/authStore');
const { StaffDashboardPage, StaffStoresPage } = await import('./StaffDashboard');

const member = (slug: string, role: 'STAFF' | 'MANAGER' = 'STAFF') => ({
  storeId: `id-${slug}`,
  storeSlug: slug,
  storeName: `Store ${slug}`,
  role,
});
function signInAt(...slugs: string[]) {
  useAuthStore.setState({
    token: 't',
    user: {
      id: 'u',
      name: 'U',
      email: 'u@example.test',
      phone: null,
      role: 'CUSTOMER',
      createdAt: '2026-11-01T00:00:00Z',
      memberships: slugs.map((s) => member(s)),
      ownedBrands: [],
    },
  });
}

describe('StaffDashboardPage clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The header's clock ticks every second; the board holds up to hundreds of cards, so a tick must not re-render it.
  it('ticks the header clock without re-rendering the board', () => {
    signInAt('cafe');
    render(
      <MemoryRouter initialEntries={['/staff/cafe']}>
        <Routes>
          <Route path="/staff/:storeSlug" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const afterMount = boardRenders.count;
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(boardRenders.count).toBe(afterMount);
  });
});

describe('the staff board per store', () => {
  it('reads the orders of the store in the URL, by its id', () => {
    signInAt('cafe', 'bistro');
    render(
      <MemoryRouter initialEntries={['/staff/bistro']}>
        <Routes>
          <Route path="/staff/:storeSlug" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(ordersFor).toHaveBeenLastCalledWith({ audience: 'staff', storeId: 'id-bistro' });
    expect(screen.getByRole('button', { name: 'Pause orders' })).toBeDisabled();
  });

  it('offers a switcher with several stores and skips it with one', () => {
    const at = () =>
      render(
        <MemoryRouter initialEntries={['/staff']}>
          <Routes>
            <Route path="/staff" element={<StaffStoresPage />} />
            <Route path="/staff/:storeSlug" element={<p>board of a store</p>} />
          </Routes>
        </MemoryRouter>,
      );
    signInAt('cafe', 'bistro');
    const { unmount } = at();
    expect(screen.getByRole('link', { name: /Store bistro/ })).toHaveAttribute(
      'href',
      '/staff/bistro',
    );
    unmount();
    signInAt('cafe');
    at();
    expect(screen.getByText('board of a store')).toBeInTheDocument();
  });

  it('shows a profile saved without memberships the empty switcher, with a way out', () => {
    signInAt();
    const { user } = useAuthStore.getState();
    useAuthStore.setState({ user: { ...user!, memberships: undefined as never } });
    render(
      <MemoryRouter>
        <StaffStoresPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("You are not on a store's team.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse stores' })).toHaveAttribute('href', '/');
  });
});
