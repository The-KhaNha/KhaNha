import { z } from 'zod';
import { typedText } from './common';

/** The longest pause by minutes: 12 hours. A longer one names its end (`until`) or lasts until someone resumes. */
export const PAUSE_MINUTES_MAX = 720;
export const PAUSE_REASON_MAX = 120;

// Neither `minutes` nor `until`: paused until someone resumes.
export const pauseStoreSchema = z
  .object({
    minutes: z
      .number()
      .int('minutes must be a whole number.')
      .min(1, 'minutes must be at least 1.')
      .max(PAUSE_MINUTES_MAX, `minutes must be at most ${PAUSE_MINUTES_MAX}.`)
      .optional(),
    until: z.iso
      .datetime({ offset: true, message: 'until must be an ISO 8601 date and time.' })
      .optional(),
    reason: typedText(
      PAUSE_REASON_MAX,
      `Reason must be at most ${PAUSE_REASON_MAX} characters.`,
    ).optional(),
  })
  .refine((body) => body.minutes === undefined || body.until === undefined, {
    message: 'Send minutes or until, not both.',
    path: ['until'],
  });
export type PauseStoreInput = z.infer<typeof pauseStoreSchema>;
