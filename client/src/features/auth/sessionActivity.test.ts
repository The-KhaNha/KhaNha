import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types/api';
import { SESSION_IDLE_TTL_MS, isIdleExpired, markActive, readLastActive } from './sessionActivity';

const DAY = 24 * 60 * 60 * 1000;

describe('isIdleExpired', () => {
  it('keeps a sign-in used within the last week', () => {
    expect(isIdleExpired(1_000, 1_000 + 6 * DAY)).toBe(false);
    expect(isIdleExpired(1_000, 1_000 + SESSION_IDLE_TTL_MS)).toBe(false);
  });

  it('expires a sign-in unused for more than a week', () => {
    expect(isIdleExpired(1_000, 1_000 + SESSION_IDLE_TTL_MS + 1)).toBe(true);
  });

  it('treats a missing record as active (signed in before tracking existed)', () => {
    expect(isIdleExpired(null, Date.now())).toBe(false);
  });
});

describe('readLastActive / markActive', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips and ignores garbage', () => {
    markActive(12345);
    expect(readLastActive()).toBe(12345);
    localStorage.setItem('fp_last_active', 'nope');
    expect(readLastActive()).toBeNull();
  });

  it('logs a blocked write once at warn, not on every call', async () => {
    const { logger } = await import('../../lib/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    markActive(1);
    markActive(2);
    expect(warn).toHaveBeenCalledExactlyOnceWith('Session activity storage unavailable', {
      operation: 'markActive',
      error: 'SecurityError',
    });
  });
});

// hydrate() on app start: an idle-expired device signs out; an active one restarts its week.
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
vi.mock('../../lib/supabase', () => ({
  getSupabase: async () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
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
vi.mock('../../services/api', () => ({
  ApiError: class ApiError extends Error {},
  loadSupabase: async () => (await import('../../lib/supabase')).getSupabase(),
}));

describe('authStore.hydrate', () => {
  afterEach(() => {
    localStorage.clear();
    signOut.mockClear();
  });

  it('signs out a device that has not been used for over a week, and logs it once at warn', async () => {
    const { useAuthStore } = await import('./authStore');
    const { logger } = await import('../../lib/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    markActive(Date.now() - SESSION_IDLE_TTL_MS - 60_000);
    await useAuthStore.getState().hydrate();
    expect(warn).toHaveBeenCalledExactlyOnceWith('Session expired from inactivity', {
      idleDays: 7,
    });
    warn.mockRestore();
    expect(useAuthStore.getState()).toMatchObject({ user: null, token: null });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(readLastActive()).toBeNull();
  });

  it('keeps a recently used device signed in and restarts its week', async () => {
    const { useAuthStore } = await import('./authStore');
    const yesterday = Date.now() - DAY;
    markActive(yesterday);
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ user: me, token: 'token' });
    expect(signOut).not.toHaveBeenCalled();
    expect(readLastActive()!).toBeGreaterThan(yesterday);
  });

  it('two hydrates at once (StrictMode) sign an idle device out once and leave the week cleared', async () => {
    const { useAuthStore } = await import('./authStore');
    markActive(Date.now() - SESSION_IDLE_TTL_MS - 60_000);
    await Promise.all([useAuthStore.getState().hydrate(), useAuthStore.getState().hydrate()]);
    expect(useAuthStore.getState()).toMatchObject({ user: null, token: null });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(readLastActive()).toBeNull();
  });

  it('starts the week for a sign-in that predates tracking', async () => {
    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().user).toEqual(me);
    expect(readLastActive()).not.toBeNull();
  });
});
