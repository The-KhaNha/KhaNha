import { z } from 'zod';
import { phoneField } from './common';
import { LIMITS } from './limits';

const email = z.string().trim().toLowerCase().email('Please enter a valid email address.');

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.nameMin, `Name must be at least ${LIMITS.nameMin} characters.`)
    .max(LIMITS.nameMax, `Name must be at most ${LIMITS.nameMax} characters.`),
  email,
  password: z
    .string()
    .min(LIMITS.password.min, `Password must be at least ${LIMITS.password.min} characters.`)
    .max(LIMITS.password.max, `Password must be at most ${LIMITS.password.max} characters.`),
  phone: phoneField,
});

export type RegisterInput = z.infer<typeof registerSchema>;
