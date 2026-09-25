import { formatDayTime, formatTime } from '../lib/format';
import { cn } from '../lib/cn';

interface TimeTextProps {
  iso: string;
  /** Include "Today," / "Yesterday," / "19 Sep," prefix. */
  withDay?: boolean;
  className?: string;
}

export function TimeText({ iso, withDay = false, className }: TimeTextProps) {
  return (
    <time dateTime={iso} className={cn('tabular-nums', className)}>
      {withDay ? formatDayTime(iso) : formatTime(iso)}
    </time>
  );
}
