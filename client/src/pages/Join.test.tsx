import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ user: null as { id: string } | null, hydrate: vi.fn() }));
vi.mock('../features/auth/authStore', () => ({
  selectUser: (s: { user: unknown }) => s.user,
  useAuthStore: Object.assign((select: (s: typeof state) => unknown) => select(state), {
    getState: () => state,
  }),
}));
const accept = vi.hoisted(() => vi.fn());
vi.mock('../services/manage', () => ({ acceptInvite: accept }));

async function renderJoin() {
  const { JoinPage } = await import('./Join');
  return render(
    <MemoryRouter initialEntries={['/join']}>
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="/manage/:slug" element={<p>manage page</p>} />
        <Route path="/staff/:slug" element={<p>staff page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // A fresh module each test: the page keeps the invite token in a module variable.
  vi.resetModules();
  vi.resetAllMocks();
  state.user = null;
  state.hydrate.mockResolvedValue(undefined);
  window.history.replaceState(null, '', '/join#tok123');
});

describe('/join', () => {
  it('removes the fragment before it asks the API, and sends the token', async () => {
    state.user = { id: 'u' };
    accept.mockImplementation(async () => {
      expect(window.location.hash).toBe('');
      return { id: 'm', role: 'MANAGER', store: { id: 's', slug: 'cafe', name: 'Cafe' } };
    });
    await renderJoin();
    expect(await screen.findByText('manage page')).toBeInTheDocument();
    expect(accept).toHaveBeenCalledWith('tok123');
    expect(state.hydrate).toHaveBeenCalled();
  });

  it('sends staff to their store board', async () => {
    state.user = { id: 'u' };
    accept.mockResolvedValue({
      id: 'm',
      role: 'STAFF',
      store: { id: 's', slug: 'cafe', name: 'C' },
    });
    await renderJoin();
    expect(await screen.findByText('staff page')).toBeInTheDocument();
  });

  it('signed out: offers sign in and register, calls nothing, and has already cleared the address', async () => {
    await renderJoin();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fjoin',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('says only that the link is no longer valid, whatever the refusal was', async () => {
    state.user = { id: 'u' };
    const { ApiError } = await import('../services/api');
    accept.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'someone else’s invite'));
    await renderJoin();
    expect(await screen.findByText(/no longer valid/)).toBeInTheDocument();
    expect(screen.queryByText(/someone else/)).toBeNull();
  });

  it('shows the rate-limit message', async () => {
    state.user = { id: 'u' };
    const { ApiError } = await import('../services/api');
    accept.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many tries, wait a minute.'));
    await renderJoin();
    await waitFor(() =>
      expect(screen.getByText('Too many tries, wait a minute.')).toBeInTheDocument(),
    );
  });

  it('has nothing to try without a fragment', async () => {
    window.history.replaceState(null, '', '/join');
    state.user = { id: 'u' };
    await renderJoin();
    expect(screen.getByText(/no longer valid/)).toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
  });
});
