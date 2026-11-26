import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { User } from '../../types/api';
import { signIn } from '../../services/auth';
import { fillStorage } from '../../test/storage';
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
  memberships: [],
  ownedBrands: [],
};
// No session unless a case gives one; fetchMe answers `me` unless a case says otherwise.
const session = vi.hoisted(() => ({ current: null as { access_token: string } | null }));
const fetchMe = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({
  getSupabase: async () => ({
    auth: {
      getSession: async () => ({ data: { session: session.current } }),
      onAuthStateChange: () => {},
    },
  }),
  mayHaveSession: () => true,
}));
vi.mock('../../services/auth', () => ({
  fetchMe: () => fetchMe(),
  signIn: vi.fn(),
  signOut: () => signOut(),
  register: vi.fn(),
}));
vi.mock('../../services/api', () => ({
  ApiError: class ApiError extends Error {},
  loadSupabase: async () => (await import('../../lib/supabase')).getSupabase(),
}));

// A visibilitychange listener is registered once, as a side effect of importing this module.
const { useAuthStore } = await import('./authStore');

beforeEach(() => {
  fetchMe.mockReset();
  fetchMe.mockResolvedValue({ user: me });
});

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

// A full quota (older iOS private mode, some WebViews) made every set() throw through zustand's persist: a correct
// password showed "Something went wrong." and the catch's clearSession() threw again.
describe('authStore with browser storage full', () => {
  let full: ReturnType<typeof fillStorage>;
  beforeEach(() => {
    full = fillStorage();
  });
  afterEach(() => {
    full.mockRestore();
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null });
  });

  it('login signs in (in memory)', async () => {
    vi.mocked(signIn).mockResolvedValueOnce({ access_token: 'tok' } as Session);
    await expect(useAuthStore.getState().login('t@example.test', 'pw')).resolves.toEqual(me);
    expect(useAuthStore.getState()).toMatchObject({ user: me, token: 'tok' });
    expect(full).toHaveBeenCalled();
  });

  it('hydrate and clearSession do not throw', async () => {
    await expect(useAuthStore.getState().hydrate()).resolves.toBeUndefined();
    useAuthStore.setState({ user: me, token: 'tok' });
    expect(() => useAuthStore.getState().clearSession()).not.toThrow();
    expect(useAuthStore.getState()).toMatchObject({ user: null, token: null });
  });
});

describe('authStore.addOwnedBrand', () => {
  const brand = { id: 'b1', name: 'Waffles', slug: 'waffles' };

  it('a profile read that started before an accepted invite reads again, so the new brand stays', async () => {
    session.current = { access_token: 'tok' };
    markActive();
    useAuthStore.setState({ user: me, token: 'tok' });
    // The first answer was read on the server before the accept: it has no brand. The accept lands meanwhile.
    fetchMe
      .mockImplementationOnce(async () => {
        useAuthStore.getState().addOwnedBrand(brand);
        return { user: me };
      })
      .mockResolvedValueOnce({ user: { ...me, ownedBrands: [brand] } });
    try {
      await useAuthStore.getState().hydrate();
      expect(useAuthStore.getState().user?.ownedBrands).toEqual([brand]);
      expect(fetchMe).toHaveBeenCalledTimes(2);
    } finally {
      session.current = null;
      localStorage.clear();
    }
  });

  it('adds the brand once', () => {
    useAuthStore.setState({ user: { ...me, ownedBrands: [] }, token: 't' });
    useAuthStore.getState().addOwnedBrand(brand);
    useAuthStore.getState().addOwnedBrand(brand);
    expect(useAuthStore.getState().user?.ownedBrands).toEqual([brand]);
  });

  it('does nothing when nobody is signed in', () => {
    useAuthStore.setState({ user: null, token: null });
    useAuthStore.getState().addOwnedBrand(brand);
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('authStore.addMembership', () => {
  const cafe = { storeId: 's1', storeSlug: 'cafe', storeName: 'Cafe', role: 'STAFF' as const };

  it('adds the store once, replacing an older role there', () => {
    useAuthStore.setState({ user: { ...me, memberships: [cafe] }, token: 't' });
    useAuthStore.getState().addMembership({ ...cafe, role: 'MANAGER' });
    expect(useAuthStore.getState().user?.memberships).toEqual([{ ...cafe, role: 'MANAGER' }]);
  });

  it('does nothing when nobody is signed in', () => {
    useAuthStore.setState({ user: null, token: null });
    useAuthStore.getState().addMembership(cafe);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
describe('authStore.removeMembership', () => {
  const cafe = { storeId: 's1', storeSlug: 'cafe', storeName: 'Cafe', role: 'STAFF' as const };
  const deli = { storeId: 's2', storeSlug: 'deli', storeName: 'Deli', role: 'MANAGER' as const };

  it('a profile read that started before the store was left reads again, so the store stays gone', async () => {
    session.current = { access_token: 'tok' };
    markActive();
    useAuthStore.setState({ user: { ...me, memberships: [cafe, deli] }, token: 'tok' });
    // The first answer was read on the server before the leave: it still has the store. The leave lands meanwhile.
    fetchMe
      .mockImplementationOnce(async () => {
        useAuthStore.getState().removeMembership('s1');
        return { user: { ...me, memberships: [cafe, deli] } };
      })
      .mockResolvedValueOnce({ user: { ...me, memberships: [deli] } });
    try {
      await useAuthStore.getState().hydrate();
      expect(useAuthStore.getState().user?.memberships).toEqual([deli]);
      expect(fetchMe).toHaveBeenCalledTimes(2);
    } finally {
      session.current = null;
      localStorage.clear();
    }
  });

  it('does nothing when nobody is signed in', () => {
    useAuthStore.setState({ user: null, token: null });
    useAuthStore.getState().removeMembership('s1');
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('authStore.hydrate: sign-out while the profile read is out', () => {
  it('does not write the late profile back after clearSession', async () => {
    session.current = { access_token: 'tok' };
    markActive();
    useAuthStore.setState({ user: null, token: 'tok' });
    fetchMe.mockImplementationOnce(async () => {
      useAuthStore.getState().clearSession();
      return { user: me };
    });
    try {
      await useAuthStore.getState().hydrate();
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
    } finally {
      session.current = null;
      localStorage.clear();
    }
  });
});
