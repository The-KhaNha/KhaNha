import { z } from 'zod';

/** The CHECK constraints on public.stores' settings columns (test/api/store-settings.test.ts keeps them equal). */
export const STORE_SETTING_BOUNDS = {
  maxQuantityPerItem: { min: 1, max: 50 },
  lowStockThreshold: { min: 0, max: 50 },
  staffOrderListLimit: { min: 1, max: 500 },
  lastOrderMinutesBeforeClose: { min: 0, max: 240 },
} as const;

const setting = (name: string, { min, max }: { min: number; max: number }) =>
  z
    .number(`${name} must be a number.`)
    .int(`${name} must be a whole number.`)
    .min(min, `${name} must be at least ${min}.`)
    .max(max, `${name} must be at most ${max}.`)
    .optional();

export const updateStoreSettingsSchema = z
  .object({
    maxQuantityPerItem: setting('Quantity per item', STORE_SETTING_BOUNDS.maxQuantityPerItem),
    lowStockThreshold: setting('Low-stock threshold', STORE_SETTING_BOUNDS.lowStockThreshold),
    staffOrderListLimit: setting(
      'Staff order list limit',
      STORE_SETTING_BOUNDS.staffOrderListLimit,
    ),
    lastOrderMinutesBeforeClose: setting(
      'Last-order cutoff',
      STORE_SETTING_BOUNDS.lastOrderMinutesBeforeClose,
    ),
    staffCanEditStock: z.boolean('staffCanEditStock must be true or false.').optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one setting to change.',
  });

export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;
