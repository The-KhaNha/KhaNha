import { vi } from 'vitest';

/**
 * Browser storage that is there but full: every write throws QuotaExceededError, the way older iOS private mode, a
 * full quota or some WebViews behave (reads and the localStorage getter still work). Restore with mockRestore().
 */
export function fillStorage() {
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  });
}
