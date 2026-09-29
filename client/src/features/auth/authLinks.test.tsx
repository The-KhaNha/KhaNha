import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => new Promise(() => {}),
  mayHaveSession: () => false,
}));
const registerRequest = vi.hoisted(() => vi.fn());
vi.mock('../../services/auth', () => ({
  register: registerRequest,
  signIn: vi.fn(),
  signOut: () => Promise.resolve(),
  fetchMe: vi.fn(),
}));
const { ApiError } = await import('../../services/api');
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

describe('sign-up when the email is taken', () => {
  it('says so on the email field and focuses it, not in the banner', async () => {
    registerRequest.mockRejectedValueOnce(
      new ApiError(
        409,
        'EMAIL_TAKEN',
        'An account with this email already exists. Try signing in.',
        {
          field: 'email',
        },
      ),
    );
    at('/register', <RegisterPage />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ravi Kumar' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ravi@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute('aria-invalid', 'true');
    // Once, and it is the email field's own error (not the banner at the top of the card).
    const message = 'An account with this email already exists. Try signing in.';
    expect(screen.getAllByText(message)).toHaveLength(1);
    const describedBy = email.getAttribute('aria-describedby') ?? '';
    expect(
      describedBy.split(' ').some((id) => document.getElementById(id)?.textContent === message),
    ).toBe(true);
  });
});
