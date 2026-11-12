import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  openState,
  type ScheduleException,
  type ScheduleHours,
  type ScheduleStore,
} from '../../src/domain/schedule';

const store: ScheduleStore = { status: 'ACTIVE', isOpen: true, timezone: 'Asia/Kolkata' };
const MONDAY = '2026-11-09';
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** An instant given as an India wall time; `dayOffset` days after MONDAY. */
const india = (dayOffset: number, minutes: number) =>
  new Date(Date.parse(`${MONDAY}T00:00:00+05:30`) + dayOffset * 86_400_000 + minutes * 60_000);
const dateOf = (dayOffset: number) =>
  new Date(Date.parse(`${MONDAY}T00:00:00Z`) + dayOffset * 86_400_000).toISOString().slice(0, 10);
const week = (opens: number, closes: number, dayOfWeek = 1): ScheduleHours[] => [
  { dayOfWeek, opensAt: hhmm(opens), closesAt: hhmm(closes) },
];
const special = (
  kind: ScheduleException['kind'],
  dayOffset: number,
  opens: number,
  closes: number,
): ScheduleException => ({
  startsOn: dateOf(dayOffset),
  endsOn: dateOf(dayOffset),
  kind,
  opensAt: kind === 'CLOSED' ? null : hhmm(opens),
  closesAt: kind === 'CLOSED' ? null : hhmm(closes),
  label: 'Diwali',
});
const orders = (state: string) => state === 'OPEN' || state === 'CLOSING_SOON';
const weeks = fc.integer({ min: 0, max: 52 }).map((n) => n * 7);

describe('openState', () => {
  it('is OPEN with no weekly hours, by the manual switch alone', () => {
    expect(openState(store, [], [], 15, india(0, 3 * 60)).state).toBe('OPEN');
    expect(openState({ ...store, isOpen: false }, [], [], 15, india(0, 3 * 60)).state).toBe(
      'CLOSED',
    );
    expect(openState({ ...store, status: 'SUSPENDED' }, [], [], 15, india(0, 0)).state).toBe(
      'UNAVAILABLE',
    );
  });

  it("counts yesterday's interval past midnight", () => {
    fc.assert(
      fc.property(weeks, fc.integer({ min: 0, max: 119 }), (days, minute) => {
        const state = openState(store, week(18 * 60, 2 * 60), [], 0, india(days + 1, minute));
        expect(orders(state.state)).toBe(true);
      }),
    );
    expect(openState(store, week(18 * 60, 2 * 60), [], 0, india(1, 120)).state).toBe('CLOSED');
  });

  it('lets SPECIAL_HOURS replace the week for the days they cover', () => {
    fc.assert(
      fc.property(weeks, fc.integer({ min: 0, max: 1439 }), (days, minute) => {
        const state = openState(
          store,
          week(9 * 60, 17 * 60),
          [special('SPECIAL_HOURS', days, 12 * 60, 14 * 60)],
          0,
          india(days, minute),
        );
        expect(orders(state.state)).toBe(minute >= 12 * 60 && minute < 14 * 60);
      }),
    );
  });

  it('lets CLOSED beat SPECIAL_HOURS on the same day, and names the reason', () => {
    fc.assert(
      fc.property(weeks, fc.integer({ min: 0, max: 1439 }), (days, minute) => {
        const state = openState(
          store,
          week(9 * 60, 17 * 60),
          [special('SPECIAL_HOURS', days, 0, 23 * 60), special('CLOSED', days, 0, 0)],
          0,
          india(days, minute),
        );
        expect(state.state).toBe('CLOSED');
        expect(state.label).toBe('Closed for Diwali');
      }),
    );
  });

  it('stops taking orders exactly lastOrderMinutes before closing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 9 * 60, max: 17 * 60 + 60 }),
        (cutoff, minute) => {
          const state = openState(store, week(9 * 60, 17 * 60), [], cutoff, india(0, minute));
          expect(orders(state.state)).toBe(minute < 17 * 60 - cutoff);
        },
      ),
    );
  });

  it('names when ordering stops while open: the cutoff, not the closing time', () => {
    const cutoff = openState(store, week(9 * 60, 17 * 60), [], 30, india(0, 12 * 60));
    expect(cutoff).toMatchObject({ state: 'OPEN', label: 'Last orders at 4:30 PM' });
    expect(cutoff.nextChangeAt).toEqual(india(0, 16 * 60 + 30));
    const none = openState(store, week(9 * 60, 17 * 60), [], 0, india(0, 12 * 60));
    expect(none).toMatchObject({ state: 'OPEN', label: 'Closes at 5:00 PM' });
    expect(none.nextChangeAt).toEqual(india(0, 17 * 60));
  });

  it('names the next opening, in the store zone', () => {
    const state = openState(store, week(9 * 60, 17 * 60), [], 15, india(0, 8 * 60));
    expect(state).toMatchObject({ state: 'CLOSED', label: 'Opens at 9:00 AM' });
    expect(state.nextChangeAt).toEqual(india(0, 9 * 60));
    const evening = openState(store, week(9 * 60, 17 * 60), [], 15, india(0, 18 * 60));
    expect(evening.label).toMatch(/^Opens Mon at 9:00 AM$/);
  });

  it('puts nextChangeAt after now, whatever the week and the time', () => {
    const interval = fc
      .record({
        dayOfWeek: fc.integer({ min: 1, max: 7 }),
        opens: fc.integer({ min: 0, max: 1439 }),
        closes: fc.integer({ min: 0, max: 1439 }),
      })
      .filter((i) => i.opens !== i.closes)
      .map((i): ScheduleHours => ({
        dayOfWeek: i.dayOfWeek,
        opensAt: hhmm(i.opens),
        closesAt: hhmm(i.closes),
      }));
    fc.assert(
      fc.property(
        fc.array(interval, { maxLength: 8 }),
        fc.integer({ min: 0, max: 30 * 24 * 60 }),
        fc.integer({ min: 0, max: 120 }),
        (hours, minutesIn, cutoff) => {
          const now = india(0, minutesIn);
          const { nextChangeAt } = openState(store, hours, [], cutoff, now);
          if (nextChangeAt) expect(nextChangeAt.getTime()).toBeGreaterThan(now.getTime());
        },
      ),
    );
  });

  it('measures a night with a clock change in real time', () => {
    // New York springs forward on Sunday 2026-03-08 at 02:00: a 01:00-04:00 interval lasts two hours.
    const ny: ScheduleStore = { ...store, timezone: 'America/New_York' };
    const hours: ScheduleHours[] = [{ dayOfWeek: 7, opensAt: '01:00', closesAt: '04:00' }];
    const open = openState(ny, hours, [], 0, new Date('2026-03-08T06:30:00Z'));
    expect(open.state).toBe('OPEN');
    expect(open.nextChangeAt).toEqual(new Date('2026-03-08T08:00:00Z'));
    expect(openState(ny, hours, [], 0, new Date('2026-03-08T08:00:00Z')).state).toBe('CLOSED');
  });

  it('reads PAUSED until the pause ends, once the inputs exist', () => {
    const until = india(0, 15 * 60);
    const paused = { ...store, acceptingOrders: false, pausedUntil: until };
    expect(openState(paused, [], [], 0, india(0, 14 * 60))).toMatchObject({
      state: 'PAUSED',
      nextChangeAt: until,
    });
    expect(openState(paused, [], [], 0, india(0, 16 * 60)).state).toBe('OPEN');
  });
});
