import { z } from 'zod';

import { HOURS_LIMITS } from './limits';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time as HH:MM (24-hour).');
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD.')
  .refine(
    (d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d),
    'That date does not exist.',
  );

export const setStoreHoursSchema = z.object({
  hours: z
    .array(
      z
        .object({
          dayOfWeek: z
            .number()
            .int()
            .min(1, 'dayOfWeek is 1 (Monday) to 7.')
            .max(7, 'dayOfWeek is 1 (Monday) to 7.'),
          opensAt: time,
          closesAt: time,
        })
        .refine(
          (h) => h.opensAt !== h.closesAt,
          'An interval cannot open and close at the same time.',
        ),
    )
    .max(7 * HOURS_LIMITS.intervalsPerDay, 'Too many intervals.')
    .refine(
      (hours) =>
        [1, 2, 3, 4, 5, 6, 7].every(
          (day) => hours.filter((h) => h.dayOfWeek === day).length <= HOURS_LIMITS.intervalsPerDay,
        ),
      `At most ${HOURS_LIMITS.intervalsPerDay} intervals a day.`,
    ),
});
export type SetStoreHoursInput = z.infer<typeof setStoreHoursSchema>;

export const createExceptionSchema = z
  .object({
    startsOn: date,
    endsOn: date,
    kind: z.enum(['CLOSED', 'SPECIAL_HOURS'], 'kind must be CLOSED or SPECIAL_HOURS.'),
    opensAt: time.optional(),
    closesAt: time.optional(),
    label: z.string().trim().min(2, 'The label is too short.').max(60, 'The label is too long.'),
  })
  .refine((e) => e.endsOn >= e.startsOn, {
    message: 'endsOn cannot be before startsOn.',
    path: ['endsOn'],
  })
  .refine(
    (e) =>
      e.kind === 'CLOSED'
        ? e.opensAt === undefined && e.closesAt === undefined
        : e.opensAt !== undefined && e.closesAt !== undefined && e.opensAt !== e.closesAt,
    { message: 'SPECIAL_HOURS needs opensAt and closesAt (different); CLOSED takes neither.' },
  );
export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;
