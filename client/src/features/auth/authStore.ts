import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../../types/api';
import { supabase } from '../../lib/supabase';
import { ApiError } from '../../services/api';
import { fetchMe, register as registerRequest, signIn, signOut } from '../../services/auth';
import type { RegisterInput } from '../../services/auth';

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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,

      async login(email, password) {
        const session = await signIn(email, password);
        try {
          const { user } = await fetchMe();
          set({ user, token: session.access_token });
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
        void signOut();
      },

      clearSession() {
        set({ user: null, token: null });
        void signOut();
      },

      async hydrate() {
        // Refreshes an expired access token when the refresh token is still valid.
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          set({ user: null, token: null });
          return;
        }
        set({ token: data.session.access_token });
        try {
          const { user } = await fetchMe();
          set({ user });
        } catch (err) {
          // A 401 has already cleared the session in the API layer.
          // Any other failure (server down) keeps the persisted session so the app stays usable.
          if (err instanceof ApiError && err.status === 401) set({ user: null, token: null });
        }
      },
    }),
    {
      name: 'fp_auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
    },
  ),
);

// Keeps `token` in step with supabase-js: refreshed tokens, sign-out in another tab, or a session that ended.
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) useAuthStore.setState({ token: session.access_token });
  else useAuthStore.setState({ user: null, token: null });
});

export const selectUser = (state: AuthState) => state.user;
