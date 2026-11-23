import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../../pages/Login';
import { RegisterPage } from '../../pages/Register';
import type { User } from '../../types/api';
import { useAuthStore } from './authStore';
import { useAuthRedirect } from './useAuthRedirect';

// The three hosts (lib/hosts.ts) are off unless a case turns them on, with this page's host as the customer one.
const hosts = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('../../lib/runtimeEnv', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/runtimeEnv')>();
  return { ...real, runtimeEnv: { ...real.runtimeEnv, hosts } };
});
const hostsOn = () =>
  Object.assign(hosts, { customer: window.location.host, staff: 'staff.x', admin: 'admin.x' });
afterEach(() => {
  for (const k of Object.keys(hosts)) delete hosts[k];
  useAuthStore.setState({ user: null });
});

const staff = {
  id: 'u',
  role: 'CUSTOMER',
  memberships: [{ storeId: 's1', storeSlug: 'cafe', storeName: 'Cafe', role: 'STAFF' }],
  ownedBrands: [],
} as unknown as User;
const customer = { ...staff, memberships: [] } as unknown as User;

function SignIn({ user }: { user: User }) {
  const redirectAfterAuth = useAuthRedirect();
  return <button onClick={() => redirectAfterAuth(user)}>Sign in</button>;
}
function Where() {
  return <p>at {useLocation().pathname}</p>;
}

const signInAt = (entry: string, user: User) => {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<SignIn user={user} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('Sign in'));
};

describe('useAuthRedirect', () => {
  // A store member opening an invite link while signed out must come back to /join to accept it.
  it('sends anyone back to a safe ?next, store staff included', () => {
    signInAt('/login?next=%2Fjoin', staff);
    expect(screen.getByText('at /join')).toBeInTheDocument();
  });

  it('without ?next, each account goes to its own home', () => {
    signInAt('/login', staff);
    expect(screen.getByText('at /staff')).toBeInTheDocument();
  });

  it('ignores a ?next that leaves the app', () => {
    signInAt('/login?next=%2F%2Fevil.example', customer);
    expect(screen.getByText('at /')).toBeInTheDocument();
  });

  it("with the three hosts on, a sign-in on the customer host stays there, not on staff.'s board", () => {
    hostsOn();
    signInAt('/login', staff);
    expect(screen.getByText('at /')).toBeInTheDocument();
  });

  it.each([
    ['/login', LoginPage],
    ['/register', RegisterPage],
  ])('%s, already signed in, sends the account home on this host', (path, Page) => {
    hostsOn();
    useAuthStore.setState({ user: staff });
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={<Page />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('at /')).toBeInTheDocument();
  });
});
