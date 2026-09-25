import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../../types/api';
import { ApiError } from '../../services/api';
import { fetchMe, login as loginRequest, register as registerRequest } from '../../services/auth';
import type { RegisterInput } from '../../services/auth';

interface AuthState {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
  /** Validates a persisted token against GET /api/auth/me on app start. */
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
        const { user, token } = await loginRequest(email, password);
        set({ user, token });
        return user;
      },

      async register(input) {
        const { user, token } = await registerRequest(input);
        set({ user, token });
        return user;
      },

      logout() {
        set({ user: null, token: null });
      },

      clearSession() {
        set({ user: null, token: null });
      },

      async hydrate() {
        if (!get().token) {
          set({ user: null });
          return;
        }
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

export const selectUser = (state: AuthState) => state.user;
