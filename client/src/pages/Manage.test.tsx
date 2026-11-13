import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ManageStoreResponse,
  ManagedStore,
  MyBrand,
  Store,
  StoreSummary,
  User,
} from '../types/api';

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
  brands: null as MyBrand[] | null,
  brandsError: null as null | { message: string; isUnreachable: boolean },
  managed: {} as Record<string, ManageStoreResponse>,
  managedError: null as null | { status: number; message: string; isUnreachable: boolean },
}));
const managedStore = (id: string, over: Partial<ManagedStore> = {}): ManagedStore => ({
  id,
  slug: id,
  name: `Store ${id}`,
  status: 'ACTIVE',
  isTemplate: false,
  area: null,
  address: null,
  contactPhone: null,
  tagline: '',
  description: '',
  imageUrl: null,
  createdAt: '',
  ...over,
});
const brand = { id: 'b1', name: 'Brew', slug: 'b1' };
const manage = (
  id: string,
  over: Partial<ManagedStore> = {},
  missing: ManageStoreResponse['missing'] = [],
) => {
  state.managed[id] = { store: managedStore(id, over), brand, missing };
};
vi.mock('../features/manage/useManage', async (actual) => ({
  ...(await actual<typeof import('../features/manage/useManage')>()),
  useMyBrands: (enabled: boolean) => ({
    data: enabled ? state.brands : null,
    isLoading: false,
    error: enabled ? state.brandsError : null,
    reload: () => {},
  }),
  useManagedStore: (id: string | null) => ({
    data: id ? (state.managed[id] ?? null) : null,
    isLoading: false,
    error: id ? state.managedError : null,
    reload: () => {},
  }),
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
// The hours tab loads its week through the services; it is tested in ManageHours.test.tsx.
vi.mock('../services/stores', () => ({ fetchStoreHours: () => new Promise(() => {}) }));
const publishStore = vi.hoisted(() => vi.fn());
vi.mock('../services/manageStores', async (actual) => ({
  ...(await actual<typeof import('../services/manageStores')>()),
  publishStore,
}));
const dropped = vi.hoisted(() => vi.fn());
vi.mock('../lib/useResource', async (actual) => ({
  ...(await actual<typeof import('../lib/useResource')>()),
  dropPersisted: dropped,
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
  state.brands = null;
  state.brandsError = null;
  state.managed = {};
  state.managedError = null;
});
const owner = () => user({ ownedBrands: [brand] });

describe('/manage picker', () => {
  it('sends a signed-out visitor to sign in', () => {
    state.token = null;
    renderAt('/manage');
    expect(screen.getByText('Sign in page')).toBeInTheDocument();
  });

  it("keeps an admin's saved list on a failed refresh, says so and offers a retry", () => {
    state.user = user({ role: 'ADMIN' });
    state.stores = [summary('a'), summary('b')];
    state.storesError = { message: 'offline', isUnreachable: true };
    state.updatedAt = null;
    renderAt('/manage');
    expect(screen.getByText('Showing saved stores')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Store a/ })).toBeInTheDocument();
  });

  it("lists the owner's template first, then every branch at any status, and offers to open one", () => {
    state.user = owner();
    state.brands = [
      {
        ...brand,
        template: managedStore('t', { isTemplate: true, status: 'DRAFT' }),
        stores: [managedStore('a'), managedStore('d', { status: 'DRAFT' })],
      },
    ];
    state.stores = [summary('a'), summary('c', 'b2')];
    renderAt('/manage');
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/manage/t',
      '/manage/a',
      '/manage/d',
    ]);
    expect(links[0]).toHaveTextContent('Brand template');
    expect(links[2]).toHaveTextContent('Draft: not public yet');
    fireEvent.click(screen.getByRole('button', { name: 'Open a branch' }));
    expect(screen.getByRole('form', { name: 'Open a branch' })).toBeInTheDocument();
  });

  it("says why when the owner's brands fail to load, with a retry", () => {
    state.user = owner();
    state.brandsError = { message: 'Server down', isUnreachable: false };
    renderAt('/manage');
    expect(screen.getByText('Server down')).toBeInTheDocument();
  });

  it('goes straight to the one store a manager manages, ignoring a STAFF membership', () => {
    state.user = user({
      memberships: [
        { storeId: 'a', storeSlug: 'a', storeName: 'A', role: 'MANAGER' },
        { storeId: 'b', storeSlug: 'b', storeName: 'B', role: 'STAFF' },
      ],
    });
    manage('a');
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
    manage('a');
    renderAt('/manage/a');
    const nav = screen.getByRole('navigation', { name: 'Manage' });
    for (const tab of ['hours', 'settings', 'team'])
      expect(nav.querySelector(`a[href="/manage/a/${tab}"]`)).not.toBeNull();
    expect(screen.getByLabelText('Loading the hours')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hours' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the saved store on a failed refresh and says so', () => {
    state.user = owner();
    state.brands = [{ ...brand, template: null, stores: [managedStore('a')] }];
    manage('a');
    state.managedError = { status: 0, message: 'offline', isUnreachable: true };
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

  it('a template has only what branches copy: Menu, Profile and Settings, and no Go live', () => {
    state.user = owner();
    state.brands = [
      { ...brand, template: managedStore('t', { isTemplate: true, status: 'DRAFT' }), stores: [] },
    ];
    manage('t', { isTemplate: true, status: 'DRAFT' }, ['address', 'hours']);
    renderAt('/manage/t/profile');
    const nav = screen.getByRole('navigation', { name: 'Manage' });
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
      'Menu',
      'Profile',
      'Settings',
    ]);
    expect(screen.getByRole('heading', { name: 'Brew: brand template' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Go live' })).toBeNull();
  });

  it('the owner of a DRAFT branch sees Go live; its manager does not', () => {
    state.user = owner();
    state.brands = [{ ...brand, template: null, stores: [managedStore('d', { status: 'DRAFT' })] }];
    manage('d', { status: 'DRAFT' }, ['hours']);
    const { unmount } = renderAt('/manage/d/profile');
    expect(screen.getByRole('region', { name: 'Go live' })).toBeInTheDocument();
    unmount();
    state.user = user({
      memberships: [{ storeId: 'd', storeSlug: 'd', storeName: 'D', role: 'MANAGER' }],
    });
    renderAt('/manage/d/profile');
    expect(screen.getByRole('heading', { name: 'Store d' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Go live' })).toBeNull();
  });

  it("a publish drops this browser's saved public copy of the store, so it never shows the old one", async () => {
    publishStore.mockResolvedValue(managedStore('d'));
    state.user = owner();
    state.brands = [{ ...brand, template: null, stores: [managedStore('d', { status: 'DRAFT' })] }];
    manage('d', { status: 'DRAFT' }, []);
    renderAt('/manage/d/hours');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(dropped).toHaveBeenCalledWith('store:d'));
  });
});
