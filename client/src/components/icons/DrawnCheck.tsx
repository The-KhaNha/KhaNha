interface DrawnCheckProps {
  className?: string;
}

/**
 * A check mark whose stroke draws itself in (`animate-draw`). Custom because the animation needs `pathLength` and
 * a dash array on the path itself, which lucide icons do not expose.
 */
export function DrawnCheck({ className }: DrawnCheckProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        d="M5 12.5l4.5 4.5L19 7"
        pathLength={48}
        strokeDasharray={48}
        className="animate-draw"
      />
    </svg>
  );
}
