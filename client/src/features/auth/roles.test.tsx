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

describe('homeFor', () => {
  it('sends each role to its own landing page', () => {
    expect(homeFor('CUSTOMER')).toBe('/');
    expect(homeFor('STAFF')).toBe('/staff');
    expect(homeFor('ADMIN')).toBe('/admin');
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
