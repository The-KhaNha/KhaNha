import type { OverflowEdges } from '../lib/useOverflowEdges';
import { cn } from '../lib/cn';

/** The page-coloured fades over a sideways-scrolling row, shown only on a side that hides more (useOverflowEdges). */
export function EdgeFades({ edges }: { edges: OverflowEdges }) {
  const fade = 'pointer-events-none absolute inset-y-0 w-8 transition-opacity duration-200';
  return (
    <>
      <div
        aria-hidden
        className={cn(
          fade,
          'left-0 bg-gradient-to-r from-bg to-transparent',
          edges.left ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        aria-hidden
        className={cn(
          fade,
          'right-0 bg-gradient-to-l from-bg to-transparent',
          edges.right ? 'opacity-100' : 'opacity-0',
        )}
      />
    </>
  );
}
