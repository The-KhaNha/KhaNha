import { useState } from 'react';
import { logger } from './logger';

/**
 * What a visitor has typed into a form, kept in this tab's sessionStorage so a refresh or Back keeps it. It dies with
 * the tab and is cleared on sign-in and sign-out (features/auth/authStore.ts), so on a shared phone one person's typing
 * never reaches the next. Only plain strings, and never a password.
 */
export function useSessionDraft<T extends Record<string, string>>(
  key: string,
  initial: T,
): [T, (patch: Partial<T>) => void, () => void] {
  const [draft, setDraft] = useState<T>(() => ({ ...initial, ...readDraft(key) }));

  function update(patch: Partial<T>) {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      writeDraft(key, next);
      return next;
    });
  }

  function clear() {
    clearSessionDraft(key);
    setDraft(initial);
  }

  return [draft, update, clear];
}

/** Drops a draft without the form mounted (sign-in, sign-out). */
export function clearSessionDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch (err) {
    logger.debug('Session draft storage unavailable', { key, err });
  }
}

function readDraft(key: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function writeDraft(key: string, value: Record<string, string>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Private mode or a full quota: the form still works, it just does not survive a refresh.
    logger.debug('Session draft storage unavailable', { key, err });
  }
}
