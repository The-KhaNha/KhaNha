import { afterEach, describe, expect, it } from 'vitest';
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
