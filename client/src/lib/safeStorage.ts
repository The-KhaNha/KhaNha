import { createJSONStorage, type PersistStorage } from 'zustand/middleware';
import { logger } from './logger';

// A store writes on every set(): report each key's failure once, not on every tap.
const reported = new Set<string>();

function reportFailure(name: string, operation: 'read' | 'write' | 'remove', err: unknown): void {
  if (reported.has(name)) return;
  reported.add(name);
  const error = err instanceof Error || err instanceof DOMException ? err.name : 'Unknown';
  logger.debug('Store storage unavailable', { key: name, operation, error });
}

/**
 * The `storage` for every zustand `persist` store (lib/safeStorage.test.ts fails for one without it). persist writes
 * inside each set(), synchronously and without a catch, so a full quota (QuotaExceededError: older iOS private mode,
 * a full disk, some WebViews) threw out of ordinary actions, a menu load's cart sync or a sign-in, and took the page
 * down. Here a failed read, write or removal is swallowed: the state stays right in memory and only stops surviving a
 * reload. Storage that is blocked outright (the getter throws) still leaves persist with no storage, as zustand does.
 */
export function safeJSONStorage<S>(
  getStorage: () => Storage = () => localStorage,
): PersistStorage<S> | undefined {
  return createJSONStorage<S>(() => {
    const storage = getStorage();
    return {
      getItem(name) {
        try {
          return storage.getItem(name);
        } catch (err) {
          reportFailure(name, 'read', err);
          return null;
        }
      },
      setItem(name, value) {
        try {
          storage.setItem(name, value);
        } catch (err) {
          reportFailure(name, 'write', err);
        }
      },
      removeItem(name) {
        try {
          storage.removeItem(name);
        } catch (err) {
          reportFailure(name, 'remove', err);
        }
      },
    };
  });
}
