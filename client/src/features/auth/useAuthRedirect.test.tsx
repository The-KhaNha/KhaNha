import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { User } from '../../types/api';
import { useAuthRedirect } from './useAuthRedirect';

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
});
