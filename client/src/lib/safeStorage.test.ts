import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fillStorage } from '../test/storage';
import { logger } from './logger';
import { safeJSONStorage } from './safeStorage';

const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('safeJSONStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps a store working in memory when storage is full, and reports it once', () => {
    const full = fillStorage();
    const debug = vi.spyOn(logger, 'debug');
    const useCounter = create<{ n: number; bump: () => void }>()(
      persist((set) => ({ n: 0, bump: () => set((s) => ({ n: s.n + 1 })) }), {
        name: 'test_counter',
        storage: safeJSONStorage(),
      }),
    );

    useCounter.getState().bump();
    useCounter.getState().bump();

    expect(useCounter.getState().n).toBe(2);
    expect(full).toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('persists normally when storage works', () => {
    const useCounter = create<{ n: number }>()(
      persist(() => ({ n: 7 }), { name: 'test_ok', storage: safeJSONStorage() }),
    );
    useCounter.setState({ n: 8 });
    expect(JSON.parse(localStorage.getItem('test_ok') ?? '{}')).toMatchObject({ state: { n: 8 } });
  });

  it('leaves persist without storage when the storage getter itself throws (blocked)', () => {
    const storage = safeJSONStorage(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(storage).toBeUndefined();
  });

  // The class of bug, not the one store: a new persisted store on zustand's default storage would crash on a full
  // quota again.
  it('every zustand persist store uses it', () => {
    const unsafe = Object.entries(sources)
      .filter(([, text]) => /\bpersist\(/.test(text) && !text.includes('safeJSONStorage('))
      .map(([file]) => file);
    expect(unsafe, 'pass storage: safeJSONStorage(...) to persist').toEqual([]);
  });
});
