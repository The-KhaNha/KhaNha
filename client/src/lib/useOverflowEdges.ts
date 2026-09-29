import { useCallback, useEffect, useRef, useState } from 'react';

export interface OverflowEdges {
  left: boolean;
  right: boolean;
}

/**
 * Which sides of a sideways-scrolling row still hide content, so it can fade that edge and read as scrollable
 * (a cut-off "Rea" with nothing to say there is more reads as broken). Re-measures on scroll, on resize and after
 * every render, so a label or count changing width is picked up too.
 */
export function useOverflowEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState<OverflowEdges>({ left: false, right: false });

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { left: el.scrollLeft > 4, right: max > 4 && el.scrollLeft < max - 4 };
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  useEffect(() => {
    sync();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [sync]);

  return { ref, edges, onScroll: sync };
}
