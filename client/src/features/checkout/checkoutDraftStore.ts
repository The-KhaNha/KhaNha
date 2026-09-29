import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { randomUuid } from '../../lib/uuid';

/** The checkout form as typed so far, plus the key that makes a retried "Pay" the same order. null = never typed. */
interface CheckoutDraft {
  name: string | null;
  phone: string | null;
  note: string | null;
  /**
   * One per checkout attempt: sent with POST /api/orders and reused on every retry (a timeout, a refresh while
   * "Processing payment…"), so the server answers with the order it already placed instead of a second one.
   */
  idempotencyKey: string | null;
}

type CheckoutDraftField = 'name' | 'phone' | 'note';

interface CheckoutDraftState extends CheckoutDraft {
  setField: (field: CheckoutDraftField, value: string) => void;
  /** The attempt's key, created on first use. */
  ensureKey: () => string;
  /** A new attempt with the same typed details (the server said the old key already placed an order). */
  dropKey: () => void;
  /** After the order is placed, or on sign-out: the next order starts blank with a fresh key. */
  reset: () => void;
}

const EMPTY: CheckoutDraft = { name: null, phone: null, note: null, idempotencyKey: null };

/**
 * sessionStorage, not localStorage: it survives a refresh and Back within this tab (what a customer expects) and
 * dies with the tab, so a typed name or phone never outlives the visit on a shared phone. Also cleared on sign-out by
 * features/auth/authStore.ts, which is always loaded: a subscription here would only exist once this lazy chunk had
 * loaded, and a sign-out before that would leak the draft to the next account (lib/storageKeys.test.ts).
 */
export const useCheckoutDraftStore = create<CheckoutDraftState>()(
  persist(
    (set, get) => ({
      ...EMPTY,
      setField(field, value) {
        set({ [field]: value });
      },
      ensureKey() {
        const existing = get().idempotencyKey;
        if (existing) return existing;
        const idempotencyKey = randomUuid();
        set({ idempotencyKey });
        return idempotencyKey;
      },
      dropKey() {
        set({ idempotencyKey: null });
      },
      reset() {
        set(EMPTY);
      },
    }),
    {
      name: 'fp_checkout',
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ name, phone, note, idempotencyKey }): CheckoutDraft => ({
        name,
        phone,
        note,
        idempotencyKey,
      }),
    },
  ),
);
