import type { NewException } from '../../services/stores';
import type { StoreHours } from '../../types/api';

/** Monday first, as the ISO weekday numbers the API uses. */
export const DAYS = [
  { day: 1, name: 'Monday' },
  { day: 2, name: 'Tuesday' },
  { day: 3, name: 'Wednesday' },
  { day: 4, name: 'Thursday' },
  { day: 5, name: 'Friday' },
  { day: 6, name: 'Saturday' },
  { day: 7, name: 'Sunday' },
] as const;

export interface Interval {
  opensAt: string;
  closesAt: string;
}
/** The week as the editor holds it: one list of intervals per ISO weekday. */
export type Week = Record<number, Interval[]>;

// The API caps a day at 6 intervals (docs/API.md PUT /stores/:storeId/hours); the server still enforces it.
export const MAX_INTERVALS_PER_DAY = 6;
const NEW_INTERVAL: Interval = { opensAt: '09:00', closesAt: '17:00' };

export const weekFromHours = (hours: StoreHours[]): Week => {
  const week: Week = Object.fromEntries(DAYS.map(({ day }) => [day, [] as Interval[]]));
  for (const { dayOfWeek, opensAt, closesAt } of hours)
    week[dayOfWeek]?.push({ opensAt, closesAt });
  return week;
};

export const weekToHours = (week: Week): StoreHours[] =>
  DAYS.flatMap(({ day }) => (week[day] ?? []).map((i) => ({ dayOfWeek: day, ...i })));

export const addInterval = (week: Week, day: number): Week => {
  const last = week[day]?.at(-1);
  // After the last interval a day already has: from its close to the end of the day.
  const next = last ? { opensAt: last.closesAt, closesAt: '23:59' } : NEW_INTERVAL;
  return { ...week, [day]: [...(week[day] ?? []), next] };
};

export const removeInterval = (week: Week, day: number, index: number): Week => ({
  ...week,
  [day]: (week[day] ?? []).filter((_, i) => i !== index),
});

export const editInterval = (week: Week, day: number, index: number, patch: Partial<Interval>) => ({
  ...week,
  [day]: (week[day] ?? []).map((i, n) => (n === index ? { ...i, ...patch } : i)),
});

export const copyDayToAll = (week: Week, day: number): Week =>
  Object.fromEntries(DAYS.map((d) => [d.day, (week[day] ?? []).map((i) => ({ ...i }))]));

export const sameWeek = (a: Week, b: Week) =>
  JSON.stringify(weekToHours(a)) === JSON.stringify(weekToHours(b));

/** A time input is empty while being typed; the server says what else is wrong. */
export const weekIsComplete = (week: Week) =>
  weekToHours(week).every((i) => i.opensAt !== '' && i.closesAt !== '' && i.opensAt !== i.closesAt);

export type ExceptionPreset = 'closed' | 'late';
export const PRESETS: { id: ExceptionPreset; label: string }[] = [
  { id: 'closed', label: 'Closed for …' },
  { id: 'late', label: 'Late hours' },
];

/** The first guess for a preset; the manager edits it before adding. */
export const presetDraft = (preset: ExceptionPreset, today: string): NewException =>
  preset === 'closed'
    ? { startsOn: today, endsOn: today, kind: 'CLOSED', label: 'Closed for ' }
    : {
        startsOn: today,
        endsOn: today,
        kind: 'SPECIAL_HOURS',
        opensAt: '09:00',
        closesAt: '23:00',
        label: 'Late hours',
      };

/** `YYYY-MM-DD` of the device's today. */
export const localToday = (now = new Date()) => now.toLocaleDateString('en-CA');

/** The request body for a draft: a CLOSED day carries no times. */
export const exceptionBody = (draft: NewException): NewException => ({
  startsOn: draft.startsOn,
  endsOn: draft.endsOn,
  kind: draft.kind,
  label: draft.label.trim(),
  ...(draft.kind === 'SPECIAL_HOURS' ? { opensAt: draft.opensAt, closesAt: draft.closesAt } : {}),
});

/** The `<input type="time">` look, shared by the week grid and the special-day form. */
export const timeInputClass =
  'h-11 min-w-0 flex-1 rounded-xl border border-hint bg-surface px-3 text-body text-ink outline-none ' +
  'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20';
