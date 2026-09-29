import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  getSupabase: () => Promise.reject(new Error('not in this test')),
  mayHaveSession: () => false,
}));
// Signing out talks to Supabase; here only what the auth store does locally matters.
vi.mock('../services/auth', () => ({
  signOut: () => Promise.resolve(),
  signIn: vi.fn(),
  fetchMe: vi.fn(),
  register: vi.fn(),
}));

/**
 * Every key this app writes to browser storage, and why it is safe. A new key fails the first test until it is
 * classified here: a key holding what someone typed or their own data must be cleared when a session ends, in
 * features/auth/authStore.ts (always loaded), and the second test proves it (a checkout draft once leaked to the
 * next account because only the lazy checkout chunk cleared it).
 */
const STORAGE_KEYS: Record<
  string,
  { scope: 'public' | 'device' | 'session' | 'user-typed'; why: string }
> = {
  fp_auth: {
    scope: 'session',
    why: 'the signed-in user and token mirror; logout itself empties it',
  },
  fp_last_active: {
    scope: 'session',
    why: 'the idle sign-out clock; clearActivity() on every sign-out',
  },
  fp_cache: {
    scope: 'public',
    why: 'useResource({ persist }) for public reads only (menu, store, config)',
  },
  fp_cart: {
    scope: 'device',
    why: "item ids and quantities, no personal data; a shared phone's cart by design",
  },
  fp_checkout: {
    scope: 'user-typed',
    why: 'checkout name, phone, note and key; cleared on sign-in and sign-out',
  },
  fp_register: {
    scope: 'user-typed',
    why: 'sign-up name, email, phone; cleared on sign-in and sign-out',
  },
};

const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('browser storage keys', () => {
  it('every fp_ key in the source is classified', () => {
    const found = new Set<string>();
    for (const text of Object.values(sources)) {
      for (const match of text.matchAll(/['"`](fp_[a-z_]+)/g)) found.add(match[1] ?? '');
    }
    const unclassified = [...found].filter((key) => !(key in STORAGE_KEYS));
    expect(unclassified, 'classify each new key in lib/storageKeys.test.ts').toEqual([]);
  });

  describe('user-typed keys are gone once a session ends, even if their page never loaded', () => {
    beforeEach(() => {
      sessionStorage.clear();
      vi.resetModules();
    });

    it.each(['logout', 'clearSession'] as const)('after %s()', async (end) => {
      const userTyped = Object.keys(STORAGE_KEYS).filter(
        (k) => STORAGE_KEYS[k]?.scope === 'user-typed',
      );
      for (const key of userTyped) {
        sessionStorage.setItem(
          key,
          JSON.stringify({ state: { name: 'Alice Private' }, version: 1 }),
        );
      }
      // Only the always-loaded auth store: no page, no checkout chunk.
      const { useAuthStore } = await import('../features/auth/authStore');
      useAuthStore.setState({
        user: {
          id: 'u1',
          email: 'a@example.com',
          name: 'Alice',
          phone: null,
          role: 'CUSTOMER',
          createdAt: '2026-09-28T00:00:00.000Z',
        },
        token: 't',
      });
      useAuthStore.getState()[end]();

      for (const key of userTyped) {
        expect(sessionStorage.getItem(key) ?? '', key).not.toContain('Alice Private');
      }
    });
  });
});
