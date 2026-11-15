import { z } from 'zod';
import { LIMITS } from './limits';

/** docs/API.md's message for a value Postgres or PostgREST could not take as text. */
export const INVALID_CHARACTERS = 'Invalid characters in input.';

// Characters that draw nothing yet survive trim(): the format characters (\p{Cf}: zero-width space, word joiner, the
// joiners, bidi marks), the Braille blank and the Hangul fillers. A name made of them looks filled in to the API and
// empty to the staff member calling it out. The client's features/auth/validation.ts holds the same list.
const INVISIBLE = String.raw`\p{Cf}\u2800\u115F\u1160\u3164\uFFA0`;
// Marks that draw nothing on their own but end visible text: variation selectors (U+FE0F turns U+2764 into the red
// heart emoji), the combining grapheme joiner and the Khmer inherent vowels. Never trimmed, only left out of what
// counts as visible. An alternation, not a character class: a combining mark inside a class reads as joined to the
// character before it.
const SILENT_MARKS = String.raw`\p{Variation_Selector}|\u034F|\u17B4|\u17B5`;
// Tag characters are \p{Cf}, yet they finish a subdivision flag (U+1F3F4 and tags make Scotland's): never trimmed.
const BLANK_CHARACTER = new RegExp(`^(?![\\u{E0020}-\\u{E007F}])[\\s${INVISIBLE}]$`, 'u');
const DRAWS_NOTHING = new RegExp(`[\\s${INVISIBLE}]|${SILENT_MARKS}`, 'gu');

/**
 * `value` without blank or invisible characters at either end. Inside it they stay: a zero-width joiner builds an emoji
 * sequence and a non-joiner shapes Indic script. Walked by code point, not with a `\s+$` regex, which is quadratic on a
 * long blank run that does not reach the end.
 */
export function trimBlank(value: string): string {
  const chars = Array.from(value);
  let start = 0;
  let end = chars.length;
  while (start < end && BLANK_CHARACTER.test(chars[start] ?? '')) start++;
  while (end > start && BLANK_CHARACTER.test(chars[end - 1] ?? '')) end--;
  return chars.slice(start, end).join('');
}

/**
 * The length a minimum is checked against: blank, invisible and silent characters cannot make a one-letter name long
 * enough, and a value with none of anything else is as empty as "".
 */
export const visibleLength = (value: string): number => value.replace(DRAWS_NOTHING, '').length;

/**
 * No lone UTF-16 surrogate. JSON.stringify writes one as `\ud800`, which PostgREST refuses as invalid JSON (a 500
 * after the payment ran) and Supabase Auth stores as U+FFFD.
 */
export const isWellFormed = (value: string): boolean => value.isWellFormed();

/**
 * Text a person types (a name, a note): well formed, trimmed with trimBlank, and at most `max` UTF-16 units. That is
 * what a form's maxLength and the client's `.length` count; zod's max() counts code points, so 31 emoji passed a limit
 * of 60.
 */
export const typedText = (max: number, tooLong: string) =>
  z
    .string()
    .refine(isWellFormed, INVALID_CHARACTERS)
    .transform(trimBlank)
    .refine((value) => value.length <= max, tooLong);

// A value of only blank, invisible or silent characters is as empty as "".
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && visibleLength(value) === 0 ? undefined : value;

/** Optional field where a blank string counts as "not provided" (forms send "" for untouched inputs). */
export const optionalField = <T extends z.ZodType>(schema: T) =>
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
