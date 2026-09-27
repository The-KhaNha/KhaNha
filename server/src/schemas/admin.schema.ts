import { z } from 'zod';

// Same bounds as the check constraints on public.site_settings, so a bad value is a 400, never a database error.
const limit = (name: string, max: number) =>
  z
    .number({ invalid_type_error: `${name} must be a number.` })
    .int(`${name} must be a whole number.`)
    .min(1, `${name} must be at least 1.`)
    .max(max, `${name} must be at most ${max}.`);

export const updateSettingsSchema = z
  .object({
    customerOrderHistoryLimit: limit('Customer order history limit', 200).optional(),
    staffOrderListLimit: limit('Staff order list limit', 500).optional(),
    minClientVersion: z
      .string({ invalid_type_error: 'Minimum client version must be text.' })
      .regex(/^\d+\.\d+\.\d+$/, 'Minimum client version must look like 1.2.3.')
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one setting to change.',
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
