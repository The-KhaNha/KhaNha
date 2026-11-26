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

  describe('each failing operation is swallowed and reported once per key', () => {
    function broken(): Storage {
      const fail = () => {
        throw new TypeError('boom');
      };
      return { getItem: fail, setItem: fail, removeItem: fail } as unknown as Storage;
    }

    it.each([
      ['read', (s: ReturnType<typeof safeJSONStorage>, k: string) => s?.getItem(k)],
      ['write', (s: ReturnType<typeof safeJSONStorage>, k: string) => s?.setItem(k, { state: 1 })],
      ['remove', (s: ReturnType<typeof safeJSONStorage>, k: string) => s?.removeItem(k)],
    ])('%s', (operation, run) => {
      const debug = vi.spyOn(logger, 'debug');
      const storage = safeJSONStorage(broken);
      const key = `broken_${operation}`;
      expect(() => run(storage, key)).not.toThrow();
      expect(() => run(storage, key)).not.toThrow();
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug).toHaveBeenCalledWith('Store storage unavailable', {
        key,
        operation,
        error: 'TypeError',
      });
    });

    it('a read failure returns null, and a thrown non-error is reported as Unknown', () => {
      const debug = vi.spyOn(logger, 'debug');
      const storage = safeJSONStorage(
        () =>
          ({
            getItem: () => {
              throw 'nope';
            },
          }) as unknown as Storage,
      );
      expect(storage?.getItem('unknown_kind')).toBeNull();
      expect(debug).toHaveBeenCalledWith('Store storage unavailable', {
        key: 'unknown_kind',
        operation: 'read',
        error: 'Unknown',
      });
    });
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
