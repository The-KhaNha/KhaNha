import { describe, expect, it } from 'vitest';
import { formatAgo, formatDayTime, formatPrepRange, formatPrice, initialOf } from './format';

describe('format', () => {
  it('formats rupees with Indian grouping and no paise', () => {
    expect(formatPrice(1240)).toBe('₹1,240');
    expect(formatPrice(123456)).toBe('₹1,23,456');
  });

  it('labels today, yesterday, this year and older dates', () => {
    const now = new Date(2026, 8, 26, 20, 0);
    expect(formatDayTime(new Date(2026, 8, 26, 19, 42), now)).toBe('Today, 7:42 PM');
    expect(formatDayTime(new Date(2026, 8, 25, 9, 5), now)).toBe('Yesterday, 9:05 AM');
    expect(formatDayTime(new Date(2026, 0, 3, 12, 0), now)).toBe('3 Jan, 12:00 PM');
    expect(formatDayTime(new Date(2025, 2, 19, 7, 42), now)).toBe('19 Mar 2025, 7:42 AM');
  });

  it('collapses an equal prep range', () => {
    expect(formatPrepRange(10, 15)).toBe('~10–15 min');
    expect(formatPrepRange(10, 10)).toBe('~10 min');
  });

  it('counts time ago and never goes negative', () => {
    expect(formatAgo(1_000, 3_000)).toBe('Just now');
    expect(formatAgo(0, 12_000)).toBe('12s ago');
    expect(formatAgo(0, 180_000)).toBe('3 min ago');
    expect(formatAgo(10_000, 0)).toBe('Just now');
  });

  it('takes the first letter of a name', () => {
    expect(initialOf('  anishka')).toBe('A');
    expect(initialOf('   ')).toBe('?');
  });
});
