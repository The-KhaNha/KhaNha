import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../types/api';

vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.reject(new Error('not in this test')),
  mayHaveSession: () => false,
}));
const { leaveStore } = vi.hoisted(() => ({
  leaveStore: vi.fn<(storeId: string) => Promise<void>>(),
}));
vi.mock('../services/manage', () => ({ leaveStore }));
const { ApiError } = await import('../services/api');
const { useAuthStore } = await import('../features/auth/authStore');
const { ProfilePage } = await import('./Profile');

// The page shows the account, the stores it works at (each can be left) and signs out; it has no form, so there is
// nothing to validate or save here (editable account fields would be a new feature with their own rules).
const user = (over: Partial<User> = {}): User => ({
  id: 'u1',
  name: 'Anishka Rao',
  email: 'a@example.com',
  phone: null,
  role: 'CUSTOMER',
  createdAt: '2026-11-01T00:00:00Z',
  memberships: [],
  ownedBrands: [],
  ...over,
});

const logout = vi.fn();
const hydrate = vi.fn(() => Promise.resolve());
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  logout.mockReset();
  hydrate.mockClear();
  leaveStore.mockReset();
  useAuthStore.setState({ user: null, token: null, logout, hydrate });
});

describe('the profile page', () => {
  it('asks a signed-out visitor to sign in, returning here after', () => {
    renderPage();
    expect(screen.getByText("You're not signed in")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fprofile',
    );
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('shows the name, email and a missing phone as such', () => {
    useAuthStore.setState({ user: user() });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Anishka Rao' })).toBeInTheDocument();
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByText('No phone added')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Order history/ })).toHaveAttribute('href', '/orders');
    expect(screen.queryByText(/Staff dashboard|Admin dashboard/)).not.toBeInTheDocument();
  });

  it('shows the phone when there is one', () => {
    useAuthStore.setState({ user: user({ phone: '9876543210' }) });
    renderPage();
    expect(screen.getByText('9876543210')).toBeInTheDocument();
    expect(screen.queryByText('No phone added')).not.toBeInTheDocument();
  });

  it('offers the staff dashboard to a member of a store, and the admin one only to an admin', () => {
    useAuthStore.setState({
      user: user({
        role: 'STAFF',
        memberships: [{ storeId: 's1', storeSlug: 'cafe', storeName: 'Cafe', role: 'STAFF' }],
      }),
    });
    const { unmount } = renderPage();
    expect(screen.getByRole('link', { name: /Staff dashboard/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Admin dashboard/ })).not.toBeInTheDocument();
    unmount();

    useAuthStore.setState({ user: user({ role: 'ADMIN' }) });
    renderPage();
    expect(screen.getByRole('link', { name: /Admin dashboard/ })).toBeInTheDocument();
  });

  it('logs out and returns to the home page', async () => {
    useAuthStore.setState({ user: user() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });
});

describe('your stores', () => {
  const cafe = { storeId: 's1', storeSlug: 'cafe', storeName: 'Cafe', role: 'STAFF' as const };
  const deli = { storeId: 's2', storeSlug: 'deli', storeName: 'Deli', role: 'MANAGER' as const };

  it('lists each store with its role; a customer and an owner without memberships see no list', () => {
    useAuthStore.setState({ user: user({ role: 'STAFF', memberships: [cafe, deli] }) });
    const { unmount } = renderPage();
    const list = screen.getByRole('region', { name: 'Your stores' });
    expect(within(list).getByText('Cafe')).toBeInTheDocument();
    expect(within(list).getByText('Manager')).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: /^Leave / })).toHaveLength(2);
    unmount();

    useAuthStore.setState({
      user: user({ ownedBrands: [{ id: 'b1', name: 'Brand', slug: 'brand' }] }),
    });
    renderPage();
    expect(screen.queryByRole('region', { name: 'Your stores' })).not.toBeInTheDocument();
  });

  it('leaves after the confirmation: the store goes from the list and from the account', async () => {
    leaveStore.mockResolvedValueOnce(undefined);
    useAuthStore.setState({ user: user({ role: 'STAFF', memberships: [cafe, deli] }) });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Leave Cafe' }));
    expect(leaveStore).not.toHaveBeenCalled();
    const sheet = screen.getByRole('dialog', { name: 'Leave Cafe?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Leave' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Leave Cafe?' })).not.toBeInTheDocument(),
    );
    expect(leaveStore).toHaveBeenCalledExactlyOnceWith('s1');
    expect(useAuthStore.getState().user?.memberships).toEqual([deli]);
    expect(screen.queryByText('Cafe')).not.toBeInTheDocument();
    expect(screen.getByText('Deli')).toBeInTheDocument();
    expect(hydrate).not.toHaveBeenCalled();
  });

  it('keeps the store when the sheet is closed', () => {
    useAuthStore.setState({ user: user({ role: 'STAFF', memberships: [cafe] }) });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Leave Cafe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(leaveStore).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.memberships).toEqual([cafe]);
  });

  it("a refusal keeps the store and shows the server's message", async () => {
    leaveStore.mockRejectedValueOnce(
      new ApiError(403, 'FORBIDDEN', 'You cannot do that at this store.'),
    );
    useAuthStore.setState({ user: user({ role: 'STAFF', memberships: [cafe] }) });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Leave Cafe' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Leave Cafe?' })).getByRole('button', {
        name: 'Leave',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot do that at this store.');
    expect(useAuthStore.getState().user?.memberships).toEqual([cafe]);
    // The account is read again, so a store already left (or already removed) drops out of the list.
    expect(hydrate).toHaveBeenCalledOnce();
  });
});
