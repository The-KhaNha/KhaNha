import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImagePainted } from './useImagePainted';

// An <img> without a src counts as complete (HTML spec); a cover that is still downloading does not.
function downloading(): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'complete', { value: false });
  return img;
}

describe('useImagePainted', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Frames run at once here: the tests are about which events count, not frame timing.
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0);
      return 0;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(['load', 'error'])('is painted once the image fires %s (two frames later)', (event) => {
    const { result } = renderHook(() => useImagePainted(2000));
    const img = downloading();
    act(() => result.current.ref(img));
    expect(result.current.painted).toBe(false);
    act(() => {
      img.dispatchEvent(new Event(event));
    });
    expect(result.current.painted).toBe(true);
  });

  it('counts at once for an image already in the cache', () => {
    const { result } = renderHook(() => useImagePainted(2000));
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: true });
    act(() => result.current.ref(img));
    expect(result.current.painted).toBe(true);
  });

  it('stops waiting after maxWaitMs, so a stalled image holds nothing back', () => {
    const { result } = renderHook(() => useImagePainted(2000));
    act(() => result.current.ref(downloading()));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.painted).toBe(true);
  });
});
