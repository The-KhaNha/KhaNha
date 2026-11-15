import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface LazyGroupProps {
  /** Mount at once (the first group: it is on screen at load, so a placeholder would only shift it). */
  eager?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Classes giving the placeholder its estimated height until the children mount. */
  placeholderClassName: string;
  /** A function, so nothing inside is even created until the group mounts. */
  children: () => ReactNode;
}

/**
 * A run of cards whose React mount waits until it comes within 1200px of the screen, then stays mounted. A menu of
 * 500 items or a board of 500 orders mounted every card at load, one 180–240 ms task on a cheap phone
 * (perf-auditor, P3 close); `content-visibility` skips layout and paint, not the mount. It mounts well before it is
 * seen, so the placeholder's estimate never shifts what is on screen. Without IntersectionObserver (old browsers,
 * jsdom) everything mounts at once, as before.
 */
export function LazyGroup({
  eager = false,
  className,
  style,
  placeholderClassName,
  children,
}: LazyGroupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(eager || typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (shown || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: '1200px 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div
      ref={ref}
      className={className}
      style={style}
      data-lazy-group={shown ? 'shown' : 'waiting'}
    >
      {shown ? children() : <div aria-hidden className={placeholderClassName} />}
    </div>
  );
}
