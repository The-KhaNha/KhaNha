import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => new Promise(() => {}),
  mayHaveSession: () => false,
}));
const { LoginPage } = await import('../../pages/Login');
const { RegisterPage } = await import('../../pages/Register');

const at = (entry: string, page: JSX.Element) =>
  render(<MemoryRouter initialEntries={[entry]}>{page}</MemoryRouter>);

// A guest sent to sign in from checkout must land back at checkout, whichever of the two forms they end up using.
describe('links between sign-in and sign-up keep ?next', () => {
  it('sign-in → "Create an account"', () => {
    at('/login?next=%2Fcheckout', <LoginPage />);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register?next=%2Fcheckout',
    );
  });

  it('sign-up → "Sign in" and Back', () => {
    at('/register?next=%2Fcheckout', <RegisterPage />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fcheckout',
    );
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/login?next=%2Fcheckout',
    );
  });
});
