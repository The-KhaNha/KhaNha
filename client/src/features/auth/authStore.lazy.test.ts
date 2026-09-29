import { afterEach, describe, expect, it, vi } from 'vitest';

// Anonymous visitors must never download supabase-js (~59 KB gzip) just to find out they are signed out.
const getSupabase = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ getSupabase, mayHaveSession: () => false }));
vi.mock('../../services/auth', () => ({
  fetchMe: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  register: vi.fn(),
}));
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }));

const { useAuthStore } = await import('./authStore');

describe('authStore.hydrate for an anonymous visitor', () => {
  afterEach(() => localStorage.clear());

  it('stays signed out without loading supabase-js', async () => {
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ user: null, token: null });
    expect(getSupabase).not.toHaveBeenCalled();
  });
});
