import { useCallback, useEffect, useState } from 'react';

/**
 * Whether an <img> is on screen (loaded, or failed, and then painted), or `maxWaitMs` has passed, whichever is first:
 * attach `ref` to the image. "Painted" is two animation frames after the load event, so whatever waits on this starts
 * after the image has actually been drawn. An image already in the HTTP cache counts at once. `maxWaitMs` bounds the
 * wait so a stalled image never holds back what waits on it.
 */
export function useImagePainted(maxWaitMs: number): {
  ref: (img: HTMLImageElement | null) => void;
  painted: boolean;
} {
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setPainted(true), maxWaitMs);
    return () => window.clearTimeout(timer);
  }, [maxWaitMs]);

  const ref = useCallback((img: HTMLImageElement | null) => {
    if (!img) return;
    if (img.complete) {
      setPainted(true);
      return;
    }
    const done = () => requestAnimationFrame(() => requestAnimationFrame(() => setPainted(true)));
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }, []);

  return { ref, painted };
}
