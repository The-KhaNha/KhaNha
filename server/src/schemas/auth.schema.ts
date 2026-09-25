import { z } from 'zod';
import { phoneField } from './common';

const email = z.string().trim().toLowerCase().email('Please enter a valid email address.');

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(60, 'Name must be at most 60 characters.'),
  email,
  // bcrypt only reads the first 72 bytes, so a longer password would silently be truncated.
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters.')
    .max(72, 'Password must be at most 72 characters.'),
  phone: phoneField,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required.'),
});

export type LoginInput = z.infer<typeof loginSchema>;
