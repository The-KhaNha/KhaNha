import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBackToClose } from './useBackToClose';

const back = () => window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

afterEach(() => vi.restoreAllMocks());

describe('useBackToClose', () => {
  it('pushes an entry while open, and Back closes the sheet without leaving the page', () => {
    const onClose = vi.fn();
    const before = window.history.length;
    renderHook(() => useBackToClose(true, onClose));
    expect(window.history.length).toBe(before + 1);
    back();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closed another way, takes its entry back off, and that pop closes nothing', () => {
    const onClose = vi.fn();
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => back());
    const { rerender } = renderHook(({ open }) => useBackToClose(open, onClose), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    expect(historyBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('with sheets on sheets, Back closes only the top one', () => {
    const under = vi.fn();
    const top = vi.fn();
    renderHook(() => useBackToClose(true, under));
    renderHook(() => useBackToClose(true, top));
    back();
    expect(top).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();
    back();
    expect(under).toHaveBeenCalledTimes(1);
  });
});
