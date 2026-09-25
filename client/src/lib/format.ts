const priceFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dayFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const dayYearFormatter = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "₹1,240" — whole rupees, Indian grouping. */
export function formatPrice(value: number): string {
  return priceFormatter.format(value);
}

/** "7:42 PM" */
export function formatTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return timeFormatter.format(date).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today, 7:42 PM" · "Yesterday, 7:42 PM" · "19 Sep, 7:42 PM" · "19 Sep 2025, 7:42 PM" */
export function formatDayTime(input: string | Date, now: Date = new Date()): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  let day: string;
  if (isSameDay(date, now)) day = 'Today';
  else if (isSameDay(date, yesterday)) day = 'Yesterday';
  else if (date.getFullYear() === now.getFullYear()) day = dayFormatter.format(date);
  else day = dayYearFormatter.format(date);

  return `${day}, ${formatTime(date)}`;
}

/** "~10–15 min" */
export function formatPrepRange(minMinutes: number, maxMinutes: number): string {
  if (minMinutes === maxMinutes) return `~${maxMinutes} min`;
  return `~${minMinutes}–${maxMinutes} min`;
}

/** "Just now" · "12s ago" · "3 min ago" */
export function formatAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min ago`;
}

/** First letter of a name for avatars. */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
