import { describe, expect, it } from 'vitest';
import {
  DAYS,
  PRESETS,
  addInterval,
  canAddInterval,
  copyDayToAll,
  editInterval,
  exceptionBody,
  localToday,
  presetDraft,
  removeInterval,
  sameWeek,
  timeInputClass,
  weekFromHours,
  weekIsComplete,
  weekToHours,
  type Week,
} from './hoursRules';

const emptyWeek = (): Week => weekFromHours([]);
const twoSlots = (): Week => ({
  ...emptyWeek(),
  1: [
    { opensAt: '08:00', closesAt: '12:00' },
    { opensAt: '14:00', closesAt: '18:00' },
  ],
});

describe('weekFromHours / weekToHours', () => {
  it('groups rows by ISO weekday and round-trips them, Monday first', () => {
    const hours = [
      { dayOfWeek: 3, opensAt: '09:00', closesAt: '11:00' },
      { dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' },
      { dayOfWeek: 1, opensAt: '14:00', closesAt: '18:00' },
    ];
    const week = weekFromHours(hours);
    expect(Object.keys(week)).toHaveLength(DAYS.length);
    expect(week[1]).toHaveLength(2);
    expect(week[2]).toEqual([]);
    expect(weekToHours(week)).toEqual([hours[1], hours[2], hours[0]]);
  });

  it('ignores a row for a weekday that does not exist', () => {
    expect(
      weekToHours(weekFromHours([{ dayOfWeek: 9, opensAt: '09:00', closesAt: '10:00' }])),
    ).toEqual([]);
  });
});

describe('canAddInterval', () => {
  it.each([
    [[], true],
    [[{ opensAt: '09:00', closesAt: '17:00' }], true],
    [[{ opensAt: '09:00', closesAt: '09:00' }], false],
    [[{ opensAt: '20:00', closesAt: '02:00' }], false],
    [[{ opensAt: '09:00', closesAt: '23:59' }], false],
  ])('%j -> %s', (intervals, expected) => {
    expect(canAddInterval(intervals)).toBe(expected);
  });
});

describe('addInterval', () => {
  it('starts an empty day at 09:00-17:00 and leaves other days alone', () => {
    const week = addInterval(emptyWeek(), 2);
    expect(week[2]).toEqual([{ opensAt: '09:00', closesAt: '17:00' }]);
    expect(week[1]).toEqual([]);
  });

  it('adds after the last interval, from its close to the end of the day', () => {
    expect(addInterval(twoSlots(), 1)[1]).toEqual([
      { opensAt: '08:00', closesAt: '12:00' },
      { opensAt: '14:00', closesAt: '18:00' },
      { opensAt: '18:00', closesAt: '23:59' },
    ]);
  });

  it('copes with a week that has no entry for the day', () => {
    expect(addInterval({}, 4)[4]).toEqual([{ opensAt: '09:00', closesAt: '17:00' }]);
  });
});

describe('removeInterval', () => {
  it('removing one of two slots keeps the other', () => {
    expect(removeInterval(twoSlots(), 1, 0)[1]).toEqual([{ opensAt: '14:00', closesAt: '18:00' }]);
    expect(removeInterval(twoSlots(), 1, 1)[1]).toEqual([{ opensAt: '08:00', closesAt: '12:00' }]);
  });

  it('leaves other days alone and does not change its input', () => {
    const before = twoSlots();
    const after = removeInterval(before, 1, 0);
    expect(after[2]).toEqual([]);
    expect(before[1]).toHaveLength(2);
  });

  it('an unknown day stays empty', () => {
    expect(removeInterval({}, 5, 0)[5]).toEqual([]);
  });
});

describe('editInterval', () => {
  it('editing slot 1 leaves slot 0 untouched and keeps the field not patched', () => {
    const week = editInterval(twoSlots(), 1, 1, { closesAt: '20:00' });
    expect(week[1]).toEqual([
      { opensAt: '08:00', closesAt: '12:00' },
      { opensAt: '14:00', closesAt: '20:00' },
    ]);
  });

  it('editing slot 0 leaves slot 1 untouched', () => {
    expect(editInterval(twoSlots(), 1, 0, { opensAt: '07:00' })[1]).toEqual([
      { opensAt: '07:00', closesAt: '12:00' },
      { opensAt: '14:00', closesAt: '18:00' },
    ]);
  });

  it('an unknown day stays empty', () => {
    expect(editInterval({}, 5, 0, { opensAt: '07:00' })[5]).toEqual([]);
  });
});

describe('copyDayToAll', () => {
  it('gives every day its own copy of the chosen day', () => {
    const week = copyDayToAll(twoSlots(), 1);
    for (const { day } of DAYS) expect(week[day]).toEqual(twoSlots()[1]);
    expect(week[2]![0]).not.toBe(week[3]![0]);
    expect(week[2]![0]).not.toBe(twoSlots()[1]![0]);
  });

  it('copying an empty or missing day empties the week', () => {
    expect(weekToHours(copyDayToAll({}, 1))).toEqual([]);
  });
});

describe('sameWeek', () => {
  it('compares by content', () => {
    expect(sameWeek(twoSlots(), twoSlots())).toBe(true);
    expect(sameWeek(twoSlots(), emptyWeek())).toBe(false);
  });
});

describe('weekIsComplete', () => {
  const day = (opensAt: string, closesAt: string): Week => ({
    ...emptyWeek(),
    1: [{ opensAt, closesAt }],
  });

  it('is true for an empty week and for filled, different times', () => {
    expect(weekIsComplete(emptyWeek())).toBe(true);
    expect(weekIsComplete(day('09:00', '17:00'))).toBe(true);
  });

  it.each([
    ['no opening time', day('', '17:00')],
    ['no closing time', day('09:00', '')],
    ['both empty', day('', '')],
    ['the same open and close', day('09:00', '09:00')],
  ])('is false with %s', (_, week) => {
    expect(weekIsComplete(week)).toBe(false);
  });

  it('one bad slot among good ones makes the week incomplete', () => {
    const week = twoSlots();
    week[2] = [{ opensAt: '', closesAt: '10:00' }];
    expect(weekIsComplete(week)).toBe(false);
  });
});

describe('presets and exceptions', () => {
  it('names the two presets', () => {
    expect(PRESETS).toEqual([
      { id: 'closed', label: 'Closed for …' },
      { id: 'late', label: 'Late hours' },
    ]);
  });

  it('"closed" is a one-day CLOSED draft with a label to finish', () => {
    expect(presetDraft('closed', '2026-12-01')).toEqual({
      startsOn: '2026-12-01',
      endsOn: '2026-12-01',
      kind: 'CLOSED',
      label: 'Closed for ',
    });
  });

  it('"late" is a one-day SPECIAL_HOURS draft with times', () => {
    expect(presetDraft('late', '2026-12-01')).toEqual({
      startsOn: '2026-12-01',
      endsOn: '2026-12-01',
      kind: 'SPECIAL_HOURS',
      opensAt: '09:00',
      closesAt: '23:00',
      label: 'Late hours',
    });
  });

  it('a CLOSED body carries no times, even if the draft still holds some', () => {
    expect(
      exceptionBody({
        startsOn: '2026-12-01',
        endsOn: '2026-12-02',
        kind: 'CLOSED',
        opensAt: '09:00',
        closesAt: '10:00',
        label: '  Diwali  ',
      }),
    ).toEqual({ startsOn: '2026-12-01', endsOn: '2026-12-02', kind: 'CLOSED', label: 'Diwali' });
  });

  it('a SPECIAL_HOURS body keeps its times and a trimmed label', () => {
    expect(exceptionBody({ ...presetDraft('late', '2026-12-01'), label: ' Late ' })).toEqual({
      startsOn: '2026-12-01',
      endsOn: '2026-12-01',
      kind: 'SPECIAL_HOURS',
      opensAt: '09:00',
      closesAt: '23:00',
      label: 'Late',
    });
  });

  it('localToday is the device date as YYYY-MM-DD', () => {
    expect(localToday(new Date(2026, 10, 3, 12))).toBe('2026-11-03');
  });

  it('the time input look is a tall, focus-ringed field', () => {
    expect(timeInputClass).toContain('h-11');
    expect(timeInputClass).toContain('focus:border-brand-500');
    expect(timeInputClass).toContain('focus:ring-4 focus:ring-brand-500/20');
  });
});
