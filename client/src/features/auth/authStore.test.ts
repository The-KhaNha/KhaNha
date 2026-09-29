import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types/api';
import { SESSION_IDLE_TTL_MS, markActive, readLastActive } from './sessionActivity';

const DAY = 24 * 60 * 60 * 1000;

const signOut = vi.fn(async () => {});
const me: User = {
  id: 'u1',
  name: 'Test',
  email: 't@example.test',
  phone: null,
  role: 'CUSTOMER',
  createdAt: '2026-09-27T00:00:00Z',
};
vi.mock('../../lib/supabase', () => ({
  getSupabase: async () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => {},
    },
  }),
  mayHaveSession: () => true,
}));
vi.mock('../../services/auth', () => ({
  fetchMe: async () => ({ user: me }),
  signIn: vi.fn(),
  signOut: () => signOut(),
  register: vi.fn(),
}));
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }));

// A visibilitychange listener is registered once, as a side effect of importing this module.
const { useAuthStore } = await import('./authStore');

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

function fireVisibilityChange() {
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('authStore: visibilitychange idle check', () => {
  afterEach(() => {
    localStorage.clear();
    signOut.mockClear();
    useAuthStore.setState({ user: null, token: null });
    setHidden(false);
  });

  it('signs out a signed-in tab that comes back into view after more than a week idle', () => {
    useAuthStore.setState({ user: me, token: 'tok' });
    markActive(Date.now() - SESSION_IDLE_TTL_MS - 60_000);

    setHidden(false);
    fireVisibilityChange();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, token: null });
    expect(readLastActive()).toBeNull();
  });

  it('does nothing while the tab is still hidden, even past the idle limit', () => {
    useAuthStore.setState({ user: me, token: 'tok' });
    markActive(Date.now() - SESSION_IDLE_TTL_MS - 60_000);

    setHidden(true);
    fireVisibilityChange();

    expect(signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: me, token: 'tok' });
  });

  it('restarts the week (marks active) for a tab used within the last week', () => {
    useAuthStore.setState({ user: me, token: 'tok' });
    const yesterday = Date.now() - DAY;
    markActive(yesterday);

    setHidden(false);
    fireVisibilityChange();

    expect(signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: me, token: 'tok' });
    expect(readLastActive()!).toBeGreaterThan(yesterday);
  });

  it('does nothing when nobody is signed in (no token)', () => {
    markActive(Date.now() - SESSION_IDLE_TTL_MS - 60_000);
    setHidden(false);
    fireVisibilityChange();
    expect(signOut).not.toHaveBeenCalled();
  });
});
