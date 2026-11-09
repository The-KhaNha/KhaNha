import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVersionStore } from '../features/version/versionStore';
import { signIn, signOut } from './auth';

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/supabase')>()),
  getSupabase: () => Promise.reject(new Error('chunk failed')),
}));

describe('auth when the supabase chunk cannot load', () => {
  beforeEach(() => {
    useVersionStore.setState({ outdated: false });
    localStorage.clear();
  });

  it('signIn rejects with CLIENT_RELOAD_REQUIRED', async () => {
    await expect(signIn('a@b.co', 'secret1')).rejects.toMatchObject({
      code: 'CLIENT_RELOAD_REQUIRED',
      status: 0,
    });
  });

  // The session left in storage came back on the Reload the app asks for: a logout on a shared phone undone.
  it('signOut still signs out locally: the stored session is gone, nothing rejects', async () => {
    localStorage.setItem('sb-127-auth-token', '{}');
    localStorage.setItem('fp_cart', '{}');
    await expect(signOut()).resolves.toBeUndefined();
    expect(localStorage.getItem('sb-127-auth-token')).toBeNull();
    expect(localStorage.getItem('fp_cart')).toBe('{}');
  });
});

describe('authStore when the supabase chunk cannot load', () => {
  beforeEach(() => {
    useVersionStore.setState({ outdated: false });
    localStorage.clear();
  });

  // App starts with `void hydrate()`: a rejection there was an unhandled rejection, reported as a crash, and the
  // signed-in user lost the Reload prompt because watchAuth bypassed loadSupabase.
  it('hydrate resolves, and keeps the stored session', async () => {
    const { useAuthStore } = await import('../features/auth/authStore');
    const user = { id: 'u1', name: 'A', email: 'a@b.co', phone: null, role: 'CUSTOMER' as const };
    useAuthStore.setState({ user: { ...user, createdAt: '2026-01-01T00:00:00Z' }, token: 't' });
    await expect(useAuthStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useAuthStore.getState().token).toBe('t');
  });

  it('login rejects with CLIENT_RELOAD_REQUIRED for the form and leaves no unhandled rejection', async () => {
    const { useAuthStore } = await import('../features/auth/authStore');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(useAuthStore.getState().login('a@b.co', 'secret1')).rejects.toMatchObject({
        code: 'CLIENT_RELOAD_REQUIRED',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
