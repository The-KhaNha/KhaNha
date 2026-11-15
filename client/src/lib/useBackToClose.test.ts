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

  it('a lower sheet closed first leaves an entry that Back steps over, so one press reaches the page', () => {
    const stack: unknown[] = [null];
    vi.spyOn(window.history, 'pushState').mockImplementation((s) => void stack.push(s));
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      stack.pop();
      back();
    });
    Object.defineProperty(window.history, 'state', { configurable: true, get: () => stack.at(-1) });
    try {
      const a = renderHook(({ open }) => useBackToClose(open, vi.fn()), {
        initialProps: { open: true },
      });
      const b = renderHook(({ open }) => useBackToClose(open, vi.fn()), {
        initialProps: { open: true },
      });
      a.rerender({ open: false });
      b.rerender({ open: false });
      expect(stack).toEqual([null]);
    } finally {
      Reflect.deleteProperty(window.history, 'state');
    }
  });
});
