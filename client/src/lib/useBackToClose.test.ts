import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBackToClose } from './useBackToClose';

const back = () => window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

  it('under StrictMode (mount, unmount, mount at once), Back still closes the sheet and stays on the page', () => {
    vi.useFakeTimers();
    // Chrome's history: back() fixes its target when called and arrives a task later; a push drops forward entries.
    const entries: unknown[] = [null];
    let index = 0;
    vi.spyOn(window.history, 'pushState').mockImplementation((s) => {
      entries.splice(index + 1, Infinity, s);
      index += 1;
    });
    const traverse = (to: number) => {
      index = to;
      window.dispatchEvent(new PopStateEvent('popstate', { state: entries[to] }));
    };
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      const to = index - 1;
      window.setTimeout(() => traverse(to), 0);
    });
    Object.defineProperty(window.history, 'state', {
      configurable: true,
      get: () => entries[index],
    });
    try {
      const onClose = vi.fn();
      renderHook(() => useBackToClose(true, onClose), { wrapper: StrictMode });
      act(() => vi.runAllTimers());
      expect(index).toBeGreaterThan(0); // still on the sheet's entry, not back on the page's
      // The person presses Back once.
      act(() => {
        traverse(index - 1);
        vi.runAllTimers();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(index).toBe(0); // the page under the sheet, not the one before it
    } finally {
      Reflect.deleteProperty(window.history, 'state');
    }
  });
});
