const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

import { VALIDATION } from '../config/fallbacks';

/* The API's own bounds (config/fallbacks.json, parity-tested against server/src/schemas/limits.ts), so the API never
   rejects what the form accepted. */
export const NAME_MIN_LENGTH = VALIDATION.nameMin;
export const NAME_MAX_LENGTH = VALIDATION.nameMax;
export const PASSWORD_MIN_LENGTH = VALIDATION.password.min;
export const PASSWORD_MAX_LENGTH = VALIDATION.password.max;
export const PHONE_MIN_DIGITS = VALIDATION.phoneDigits.min;
export const PHONE_MAX_DIGITS = VALIDATION.phoneDigits.max;
export const NOTE_MAX_LENGTH = VALIDATION.noteMax;

export function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Please enter your name.';
  if (trimmed.length < NAME_MIN_LENGTH)
    return `Your name needs at least ${NAME_MIN_LENGTH} characters.`;
  if (trimmed.length > NAME_MAX_LENGTH)
    return `Keep your name to ${NAME_MAX_LENGTH} characters or fewer.`;
  return undefined;
}

export function validateEmail(value: string): string | undefined {
  if (!value.trim()) return 'Please enter your email.';
  if (!EMAIL_RE.test(value.trim())) return 'That email address doesn’t look right.';
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Please enter your password.';
  // Never trimmed, but a password of only spaces is refused, as the server's registerSchema does.
  if (!value.trim()) return 'Password cannot be only spaces.';
  if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (value.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  return undefined;
}

/**
 * Optional. Mirrors the server's phoneField: spaces, dashes and parentheses are stripped first,
 * then what remains must be an optional leading + followed by 10–15 digits.
 */
export function validatePhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const compact = trimmed.replace(/[\s\-()]/g, '');
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return 'Use digits only (spaces, dashes and brackets are fine).';
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
    return `Enter a ${PHONE_MIN_DIGITS}–${PHONE_MAX_DIGITS} digit phone number.`;
  }
  return undefined;
}

export function validateNote(value: string): string | undefined {
  if (value.trim().length > NOTE_MAX_LENGTH)
    return `Keep the note to ${NOTE_MAX_LENGTH} characters or fewer.`;
  return undefined;
}

type FieldErrors<K extends string> = Partial<Record<K, string>>;

/**
 * A field's error once it loses focus: a new problem shows, but an error already shown stays (an edit clears it,
 * errorOnChange). Pressing the form's submit button is what blurs the field, and hiding a line then moves the button
 * up under the finger between press and release: the press lands past it and nothing is sent.
 */
export const errorOnBlur =
  <K extends string>(field: K, message: string | undefined) =>
  <E extends FieldErrors<K>>(prev: E): E =>
    prev[field] || !message ? prev : { ...prev, [field]: message };

/** A field's error after an edit: once shown, it follows the value, so a fixed field clears while it is typed in. */
export const errorOnChange =
  <K extends string>(field: K, message: string | undefined) =>
  <E extends FieldErrors<K>>(prev: E): E =>
    prev[field] ? { ...prev, [field]: message } : prev;
