import { afterEach, describe, expect, it, vi } from 'vitest';
import { mayHaveSession } from './supabase';

describe('mayHaveSession', () => {
  afterEach(() => localStorage.clear());

  it('is false on a browser that never signed in', () => {
    localStorage.setItem('fp_cart', '{}');
    expect(mayHaveSession()).toBe(false);
  });

  it('is true once supabase-js has stored a session', () => {
    localStorage.setItem('sb-xkddnlxeeizaqpefhqlv-auth-token', '{}');
    expect(mayHaveSession()).toBe(true);
  });
});

describe('getSupabase', () => {
  afterEach(() => {
    vi.doUnmock('./supabaseClient');
    vi.resetModules();
  });

  it('retries a failed import once, then keeps the rejection: a later call does not re-import', async () => {
    const factory = vi.fn(() => {
      throw new Error('chunk failed');
    });
    vi.resetModules();
    vi.doMock('./supabaseClient', factory);
    const { getSupabase } = await import('./supabase');

    const first = getSupabase();
    await expect(first).rejects.toThrow();
    const second = getSupabase();
    expect(second).toBe(first);
    await expect(second).rejects.toThrow();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  // Firefox and Safari fetch a failed import() again: one dropped request must not cost the user a reload.
  it('recovers when the one retry loads', async () => {
    const supabase = { auth: {} };
    const factory = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('chunk failed');
      })
      .mockImplementation(() => ({ supabase }));
    vi.resetModules();
    vi.doMock('./supabaseClient', factory);
    const { getSupabase } = await import('./supabase');

    await expect(getSupabase()).resolves.toBe(supabase);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
