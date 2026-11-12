import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types/api';
import { homeFor } from './roles';

const auth = vi.hoisted(() => ({ token: null as string | null, user: null as User | null }));
vi.mock('./authStore', () => ({
  useAuthStore: (select: (s: typeof auth) => unknown) => select(auth),
}));
const { RequireRole } = await import('./RequireRole');
const { RequireMembership } = await import('./RequireMembership');

const user = (role: User['role']): User => ({
  id: 'u1',
  name: 'Test',
  email: 't@example.test',
  phone: null,
  role,
  createdAt: '2026-09-27T00:00:00Z',
  memberships: [],
  ownedBrands: [],
});

function renderAt(role: User['role'] | null) {
  auth.token = role ? 'token' : null;
  auth.user = role ? user(role) : null;
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route
          path="/admin"
          element={
            <RequireRole role="ADMIN">
              <p>admin page</p>
            </RequireRole>
          }
        />
        <Route path="/" element={<p>home</p>} />
        <Route path="/login" element={<p>login</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const cafe = { storeId: 's1', storeSlug: 'cafe', storeName: 'Cafe' };

describe('homeFor', () => {
  it('sends each account to its own landing page', () => {
    expect(homeFor(user('CUSTOMER'))).toBe('/');
    expect(homeFor(user('ADMIN'))).toBe('/admin');
    expect(homeFor({ ...user('CUSTOMER'), memberships: [{ ...cafe, role: 'STAFF' }] })).toBe(
      '/staff',
    );
    expect(homeFor(user('STAFF'))).toBe('/staff');
    expect(homeFor({ ...user('CUSTOMER'), memberships: [{ ...cafe, role: 'MANAGER' }] })).toBe(
      '/manage',
    );
    expect(
      homeFor({ ...user('CUSTOMER'), ownedBrands: [{ id: 'b1', name: 'Cafe', slug: 'cafe' }] }),
    ).toBe('/manage');
  });
});

describe('RequireMembership', () => {
  afterEach(() => {
    auth.token = null;
    auth.user = null;
  });

  function renderStaff(memberships: User['memberships'] | null | undefined, at = '/staff/cafe') {
    auth.token = memberships === null ? null : 'token';
    auth.user = memberships === null ? null : ({ ...user('CUSTOMER'), memberships } as User);
    render(
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route
            path="/staff"
            element={
              <RequireMembership>
                <p>switcher</p>
              </RequireMembership>
            }
          />
          <Route
            path="/staff/:storeSlug"
            element={
              <RequireMembership>
                <p>board</p>
              </RequireMembership>
            }
          />
          <Route path="/" element={<p>home</p>} />
          <Route path="/login" element={<p>login</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('lets a member of that store in', () => {
    renderStaff([{ ...cafe, role: 'STAFF' }]);
    expect(screen.getByText('board')).toBeInTheDocument();
  });

  it('sends a customer, and a member of another store only, home', () => {
    renderStaff([]);
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('sends a member of another store home', () => {
    renderStaff([{ storeId: 's2', storeSlug: 'bistro', storeName: 'Bistro', role: 'STAFF' }]);
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('opens the switcher for any signed-in account, and survives a profile saved without memberships', () => {
    renderStaff([], '/staff');
    expect(screen.getByText('switcher')).toBeInTheDocument();
  });

  it('sends a saved profile without memberships home from a board, without throwing', () => {
    renderStaff(undefined);
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to login', () => {
    renderStaff(null);
    expect(screen.getByText('login')).toBeInTheDocument();
  });
});

describe('RequireRole', () => {
  afterEach(() => {
    auth.token = null;
    auth.user = null;
  });

  it('lets the matching role in', () => {
    renderAt('ADMIN');
    expect(screen.getByText('admin page')).toBeInTheDocument();
  });

  it.each(['STAFF', 'CUSTOMER'] as const)('sends %s home', (role) => {
    renderAt(role);
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to login', () => {
    renderAt(null);
    expect(screen.getByText('login')).toBeInTheDocument();
  });
});
