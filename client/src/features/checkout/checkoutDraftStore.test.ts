import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types/api';

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => Promise.reject(new Error('not in this test')),
  mayHaveSession: () => false,
}));
const { useAuthStore } = await import('../auth/authStore');
const { useCheckoutDraftStore } = await import('./checkoutDraftStore');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const user: User = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Anishka',
  phone: null,
  role: 'CUSTOMER',
  createdAt: '2026-09-28T00:00:00.000Z',
  memberships: [],
  ownedBrands: [],
};

describe('checkoutDraftStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useCheckoutDraftStore.getState().reset();
  });

  it('keeps what was typed in sessionStorage, never localStorage', () => {
    useCheckoutDraftStore.getState().setField('name', 'Ravi');
    useCheckoutDraftStore.getState().setField('note', 'Less spicy');
    const saved = JSON.parse(sessionStorage.getItem('fp_checkout') ?? '{}') as {
      state: { name: string; note: string; phone: null };
    };
    expect(saved.state).toMatchObject({ name: 'Ravi', note: 'Less spicy', phone: null });
    expect(localStorage.getItem('fp_checkout')).toBeNull();
  });

  it('creates one idempotency key per attempt and reuses it until reset', () => {
    const key = useCheckoutDraftStore.getState().ensureKey();
    expect(key).toMatch(UUID_V4);
    expect(useCheckoutDraftStore.getState().ensureKey()).toBe(key);
    useCheckoutDraftStore.getState().reset();
    expect(useCheckoutDraftStore.getState().ensureKey()).not.toBe(key);
  });

  it('is cleared when the user signs out', () => {
    useAuthStore.setState({ user, token: 't' });
    useCheckoutDraftStore.getState().setField('phone', '9876543210');
    useCheckoutDraftStore.getState().ensureKey();
    useAuthStore.setState({ user: null, token: null });
    expect(useCheckoutDraftStore.getState()).toMatchObject({
      name: null,
      phone: null,
      note: null,
      idempotencyKey: null,
    });
  });
});
