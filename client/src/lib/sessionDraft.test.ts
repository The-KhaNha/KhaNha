import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';
import { clearSessionDraft, useSessionDraft } from './sessionDraft';

const INITIAL = { name: '', email: '' };

describe('useSessionDraft', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('keeps what was typed across a remount (a refresh) in sessionStorage only', () => {
    const first = renderHook(() => useSessionDraft('fp_test', INITIAL));
    act(() => first.result.current[1]({ name: 'Ravi' }));
    first.unmount();

    const second = renderHook(() => useSessionDraft('fp_test', INITIAL));
    expect(second.result.current[0]).toEqual({ name: 'Ravi', email: '' });
    expect(localStorage.getItem('fp_test')).toBeNull();
  });

  it('clear() and clearSessionDraft() both drop it', () => {
    const { result } = renderHook(() => useSessionDraft('fp_test', INITIAL));
    act(() => result.current[1]({ email: 'a@example.com' }));
    act(() => result.current[2]());
    expect(result.current[0]).toEqual(INITIAL);
    expect(sessionStorage.getItem('fp_test')).toBeNull();

    sessionStorage.setItem('fp_test', JSON.stringify({ name: 'x' }));
    clearSessionDraft('fp_test');
    expect(sessionStorage.getItem('fp_test')).toBeNull();
  });

  it('ignores a corrupted or non-string saved value', () => {
    sessionStorage.setItem('fp_test', '{not json');
    expect(renderHook(() => useSessionDraft('fp_test', INITIAL)).result.current[0]).toEqual(
      INITIAL,
    );
    sessionStorage.setItem('fp_test', JSON.stringify({ name: 42, email: 'b@example.com' }));
    expect(renderHook(() => useSessionDraft('fp_test', INITIAL)).result.current[0]).toEqual({
      name: '',
      email: 'b@example.com',
    });
  });

  it('starts from the initial values when nothing is saved or the saved value is not an object', () => {
    expect(renderHook(() => useSessionDraft('fp_test', INITIAL)).result.current[0]).toEqual(
      INITIAL,
    );
    for (const saved of ['null', '"text"', '7', 'true']) {
      sessionStorage.setItem('fp_test', saved);
      expect(renderHook(() => useSessionDraft('fp_test', INITIAL)).result.current[0]).toEqual(
        INITIAL,
      );
    }
  });

  it('keeps the form working and logs when storage refuses a write', () => {
    const debug = vi.spyOn(logger, 'debug');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { result } = renderHook(() => useSessionDraft('fp_test', INITIAL));
    act(() => result.current[1]({ name: 'Ravi' }));
    expect(result.current[0].name).toBe('Ravi');
    expect(debug).toHaveBeenCalledWith('Session draft storage unavailable', {
      key: 'fp_test',
      err: expect.any(DOMException),
    });
  });

  it('clearSessionDraft logs instead of throwing when storage is blocked', () => {
    const debug = vi.spyOn(logger, 'debug');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => clearSessionDraft('fp_test')).not.toThrow();
    expect(debug).toHaveBeenCalledWith('Session draft storage unavailable', {
      key: 'fp_test',
      err: expect.any(DOMException),
    });
  });
});
