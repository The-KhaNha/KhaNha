import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../types/api';

vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.reject(new Error('not in this test')),
  mayHaveSession: () => false,
}));
const { useAuthStore } = await import('../features/auth/authStore');
const { ProfilePage } = await import('./Profile');

// The page shows the account and signs out; it has no form, so there is nothing to validate or save here (editable
// account fields would be a new feature with their own rules).
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
  useAuthStore.setState({ user: null, token: null, logout });
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
