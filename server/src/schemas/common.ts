import { z, type ZodTypeAny } from 'zod';
import { LIMITS } from './limits';

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** Optional field where a blank string counts as "not provided" (forms send "" for untouched inputs). */
export const optionalField = <T extends ZodTypeAny>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

/**
 * Optional phone number. Spaces, dashes and parentheses are stripped first, then an
 * optional leading + followed by LIMITS.phoneDigits digits is required. The normalised value is what gets stored.
 */
export const phoneField = optionalField(
  z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s\-()]/g, ''))
    .pipe(
      z
        .string()
        .regex(
          new RegExp(`^\\+?\\d{${LIMITS.phoneDigits.min},${LIMITS.phoneDigits.max}}$`),
          'Enter a valid phone number.',
        ),
    ),
);
