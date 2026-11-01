import { z } from 'zod';
import { LIMITS } from './limits';

// Same bounds as the check constraints on public.site_settings, so a bad value is a 400, never a database error.
const integer = (name: string, min: number, max: number) =>
  z
    .number(`${name} must be a number.`)
    .int(`${name} must be a whole number.`)
    .min(min, `${name} must be at least ${min}.`)
    .max(max, `${name} must be at most ${max}.`);
const limit = (name: string, max: number) => integer(name, 1, max);
const pollMs = (name: string) => integer(name, LIMITS.pollMs.min, LIMITS.pollMs.max);

export const updateSettingsSchema = z
  .object({
    customerOrderHistoryLimit: limit('Customer order history limit', 200).optional(),
    staffOrderListLimit: limit('Staff order list limit', 500).optional(),
    maxLinesPerOrder: limit('Items per order', 100).optional(),
    orderPollMs: pollMs('Order page refresh').optional(),
    ordersPollMs: pollMs('Order list refresh').optional(),
    staffBoardPollMs: pollMs('Staff board refresh').optional(),
    minClientVersion: z
      .string('Minimum client version must be text.')
      .regex(/^\d+\.\d+\.\d+$/, 'Minimum client version must look like 1.2.3.')
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one setting to change.',
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
