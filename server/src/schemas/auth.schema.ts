import { z } from 'zod';
import { INVALID_CHARACTERS, isWellFormed, phoneField, typedText, visibleLength } from './common';
import { LIMITS } from './limits';

const email = z.string().trim().toLowerCase().email('Please enter a valid email address.');

export const registerSchema = z.object({
  name: typedText(LIMITS.nameMax, `Name must be at most ${LIMITS.nameMax} characters.`).refine(
    (value) => visibleLength(value) >= LIMITS.nameMin,
    `Name must be at least ${LIMITS.nameMin} characters.`,
  ),
  email,
  password: z
    .string()
    .min(LIMITS.password.min, `Password must be at least ${LIMITS.password.min} characters.`)
    .max(LIMITS.password.max, `Password must be at most ${LIMITS.password.max} characters.`)
    // Never trimmed (spaces inside a password are the owner's choice), but one of only spaces is no password at all.
    .refine((value) => value.trim().length > 0, 'Password cannot be only spaces.')
    .refine(isWellFormed, INVALID_CHARACTERS),
  phone: phoneField,
});

export type RegisterInput = z.infer<typeof registerSchema>;
