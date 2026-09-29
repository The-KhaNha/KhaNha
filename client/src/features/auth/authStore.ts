import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../../types/api';
import { logger } from '../../lib/logger';
import { getSupabase, mayHaveSession } from '../../lib/supabase';
import { ApiError } from '../../services/api';
import { fetchMe, register as registerRequest, signIn, signOut } from '../../services/auth';
import type { RegisterInput } from '../../services/auth';
import { clearActivity, isIdleExpired, markActive, readLastActive } from './sessionActivity';
import { clearSessionDraft } from '../../lib/sessionDraft';
import { useCheckoutDraftStore } from '../checkout/checkoutDraftStore';

/** The sign-up form's draft (pages/Register.tsx): typed before any account exists. */
export const REGISTER_DRAFT_KEY = 'fp_register';

interface AuthState {
  user: User | null;
  /**
   * The current Supabase access token, mirrored from supabase-js so route guards can check "signed in" synchronously.
   * API calls read the live (auto-refreshed) token from supabase-js instead.
   */
  token: string | null;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
  /** Validates the stored Supabase session against GET /api/auth/me on app start. */
  hydrate: () => Promise<void>;
  /** Drops the session locally (used by the API layer on 401). */
  clearSession: () => void;
}

let hydrating: Promise<void> | null = null;

/** warn, the lowest level production builds keep: a "why was I signed out?" report then has a trace. */
function logIdleExpiry(lastActive: number | null): void {
  const idleDays = lastActive === null ? null : Math.floor((Date.now() - lastActive) / 86_400_000);
  logger.warn('Session expired from inactivity', { idleDays });
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,

      async login(email, password) {
        void watchAuth();
        const session = await signIn(email, password);
        try {
          const { user } = await fetchMe();
          set({ user, token: session.access_token });
          markActive();
          return user;
        } catch (err) {
          // Signed in to Supabase but the profile could not be loaded: don't leave a half-signed-in session behind.
          get().clearSession();
          throw err;
        }
      },

      async register(input) {
        await registerRequest(input);
        return get().login(input.email, input.password);
      },

      logout() {
        set({ user: null, token: null });
        clearActivity();
        void signOut();
      },

      clearSession() {
        set({ user: null, token: null });
        clearActivity();
        void signOut();
      },

      hydrate() {
        // One run at a time: a second call (StrictMode's double effect, a quick remount) waits for the first, so it
        // never sees a session the first run is still signing out.
        hydrating ??= runHydrate().finally(() => {
          hydrating = null;
        });
        return hydrating;

        async function runHydrate() {
          // A visitor who never signed in on this browser: nothing to check, and supabase-js stays unloaded.
          if (!get().token && !mayHaveSession()) {
            set({ user: null, token: null });
            return;
          }
          // Refreshes an expired access token when the refresh token is still valid.
          const { data } = await (await watchAuth()).auth.getSession();
          if (!data.session) {
            set({ user: null, token: null });
            return;
          }
          // Unused for over a week on this device: sign in again (see sessionActivity.ts).
          const lastActive = readLastActive();
          if (isIdleExpired(lastActive)) {
            logIdleExpiry(lastActive);
            set({ user: null, token: null });
            clearActivity();
            await signOut();
            return;
          }
          markActive();
          set({ token: data.session.access_token });
          try {
            const { user } = await fetchMe();
            set({ user });
          } catch (err) {
            // A 401 has already cleared the session in the API layer.
            // Any other failure (server down) keeps the persisted session so the app stays usable.
            if (err instanceof ApiError && err.status === 401) set({ user: null, token: null });
          }
        }
      },
    }),
    {
      name: 'fp_auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
    },
  ),
);

let watching = false;

/**
 * Loads supabase-js and, once, keeps `token` in step with it: refreshed tokens, sign-out in another tab, or a session
 * that ended. Runs when a session may exist (hydrate) or is about to (login); anonymous visitors never load it.
 */
async function watchAuth() {
  const supabase = await getSupabase();
  if (!watching) {
    watching = true;
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) useAuthStore.setState({ token: session.access_token });
      else useAuthStore.setState({ user: null, token: null });
    });
  }
  return supabase;
}

// Coming back to an open tab counts as use: sign out if the week ran out while it sat in the background, otherwise
// restart the week.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !useAuthStore.getState().token) return;
  const lastActive = readLastActive();
  if (isIdleExpired(lastActive)) {
    logIdleExpiry(lastActive);
    useAuthStore.getState().clearSession();
  } else markActive();
});

export const selectUser = (state: AuthState) => state.user;

/**
 * What one person typed on this device never reaches the next: every user-typed draft is dropped when a session ends
 * (log out, a 401, the idle expiry, a sign-out in another tab) and when one starts. Lives here because this module is
 * always loaded; lib/storageKeys.test.ts fails for a new storage key nobody classified.
 */
useAuthStore.subscribe((state, previous) => {
  if (Boolean(previous.user) === Boolean(state.user)) return;
  useCheckoutDraftStore.getState().reset();
  clearSessionDraft(REGISTER_DRAFT_KEY);
});
