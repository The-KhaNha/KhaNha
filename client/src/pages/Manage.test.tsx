import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store, StoreSummary, User } from '../types/api';

const summary = (id: string, brandId = 'b1'): StoreSummary => ({
  id,
  slug: id,
  name: `Store ${id}`,
  tagline: '',
  imageUrl: null,
  area: null,
  brand: { id: brandId, name: 'B', slug: brandId },
  isOpen: true,
  openState: 'OPEN',
  nextChangeAt: null,
  openLabel: null,
});
const user = (over: Partial<User>): User => ({
  id: 'u',
  name: 'U',
  email: 'u@x.test',
  phone: null,
  role: 'CUSTOMER',
  createdAt: '',
  memberships: [],
  ownedBrands: [],
  ...over,
});
const state = vi.hoisted(() => ({
  token: 't' as string | null,
  user: null as User | null,
  stores: [] as StoreSummary[],
  store: null as Store | null,
  storeError: null as null | { status: number; message: string; isUnreachable: boolean },
  storesError: null as null | { message: string; isUnreachable: boolean },
  updatedAt: 1 as number | null,
}));
vi.mock('../features/auth/authStore', () => ({
  useAuthStore: (select: (s: typeof state) => unknown) => select(state),
}));
vi.mock('../features/stores/useStores', () => ({
  useStores: () => ({
    stores: state.stores,
    isLoading: false,
    error: state.storesError,
    retry: () => {},
    updatedAt: state.updatedAt,
  }),
  useStoreByRef: () => ({
    store: state.store,
    isLoading: false,
    error: state.storeError,
    retry: () => {},
  }),
}));
const { ManagePage } = await import('./Manage');
const { ManageStorePage } = await import('./ManageStore');
const { RequireAuth } = await import('../features/auth/RequireAuth');

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/manage"
          element={
            <RequireAuth>
              <ManagePage />
            </RequireAuth>
          }
        />
        <Route
          path="/manage/:storeSlug/*"
          element={
            <RequireAuth>
              <ManageStorePage />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<p>Sign in page</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  state.token = 't';
  state.user = null;
  state.stores = [];
  state.store = null;
  state.storeError = null;
  state.storesError = null;
  state.updatedAt = 1;
});

describe('/manage picker', () => {
  it('sends a signed-out visitor to sign in', () => {
    state.token = null;
    renderAt('/manage');
    expect(screen.getByText('Sign in page')).toBeInTheDocument();
  });

  it('keeps a saved list on a failed refresh, says so and offers a retry', () => {
    state.user = user({ ownedBrands: [{ id: 'b1', name: 'B', slug: 'b1' }] });
    state.stores = [summary('a')];
    state.storesError = { message: 'offline', isUnreachable: true };
    state.updatedAt = null;
    renderAt('/manage');
    expect(screen.getByText('Showing saved stores')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Store a/ })).toBeInTheDocument();
  });

  it('lists every store of an owned brand and no one else', () => {
    state.user = user({ ownedBrands: [{ id: 'b1', name: 'B', slug: 'b1' }] });
    state.stores = [summary('a'), summary('b'), summary('c', 'b2')];
    renderAt('/manage');
    expect(screen.getByRole('link', { name: /Store a/ })).toHaveAttribute('href', '/manage/a');
    expect(screen.getByRole('link', { name: /Store b/ })).toHaveAttribute('href', '/manage/b');
    expect(screen.queryByRole('link', { name: /Store c/ })).toBeNull();
  });

  it('goes straight to the one store a manager manages, ignoring a STAFF membership', () => {
    state.user = user({
      memberships: [
        { storeId: 'a', storeSlug: 'a', storeName: 'A', role: 'MANAGER' },
        { storeId: 'b', storeSlug: 'b', storeName: 'B', role: 'STAFF' },
      ],
    });
    state.stores = [summary('a'), summary('b')];
    state.store = summary('a') as unknown as Store;
    renderAt('/manage');
    expect(screen.getByRole('heading', { name: 'Store a' })).toBeInTheDocument();
  });

  it('says so when the account manages nothing', () => {
    state.user = user({
      memberships: [{ storeId: 'a', storeSlug: 'a', storeName: 'A', role: 'STAFF' }],
    });
    state.stores = [summary('a')];
    renderAt('/manage');
    expect(screen.getByText('No stores to manage')).toBeInTheDocument();
  });

  it('shows an admin every active store', () => {
    state.user = user({ role: 'ADMIN' });
    state.stores = [summary('a'), summary('b', 'b2')];
    renderAt('/manage');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});

describe('/manage/:storeSlug shell', () => {
  it('shows the tabs as links, Hours first', () => {
    state.user = user({
      memberships: [{ storeId: 'a', storeSlug: 'a', storeName: 'A', role: 'MANAGER' }],
    });
    state.store = summary('a') as unknown as Store;
    renderAt('/manage/a');
    const nav = screen.getByRole('navigation', { name: 'Manage' });
    for (const tab of ['hours', 'settings', 'team'])
      expect(nav.querySelector(`a[href="/manage/a/${tab}"]`)).not.toBeNull();
    expect(screen.getByText('Coming next')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hours' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the saved store on a failed refresh and says so', () => {
    state.user = user({ ownedBrands: [{ id: 'b1', name: 'B', slug: 'b1' }] });
    state.store = summary('a') as unknown as Store;
    state.storeError = { status: 0, message: 'offline', isUnreachable: true };
    renderAt('/manage/a');
    expect(screen.getByText('Showing the saved store')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Manage' })).toBeInTheDocument();
  });

  it('is not found for a store the account does not manage', () => {
    state.user = user({
      memberships: [{ storeId: 'a', storeSlug: 'a', storeName: 'A', role: 'STAFF' }],
    });
    state.store = summary('a') as unknown as Store;
    renderAt('/manage/a/hours');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Manage' })).toBeNull();
  });

  it('is not found when the store does not exist', () => {
    state.user = user({ role: 'ADMIN' });
    state.storeError = { status: 404, message: 'Not found', isUnreachable: false };
    renderAt('/manage/zzz');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});
