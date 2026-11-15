import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSessionDraft, useSessionDraft } from './sessionDraft';

const INITIAL = { name: '', email: '' };

describe('useSessionDraft', () => {
  beforeEach(() => sessionStorage.clear());

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
});
