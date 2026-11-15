import { z } from 'zod';
import { LIMITS } from './limits';

const { stockMax } = LIMITS.menuItem;

/** public.stock_reason: why stock was changed by hand. */
export const STOCK_REASONS = ['MANUAL_SET', 'MANUAL_ADJUST', 'WASTE'] as const;

/**
 * One stock change: `set` (N available now), `adjust` (±n) or `untracked` (stop counting). `reason` defaults from the
 * kind of change; WASTE is a negative adjustment. adjust_stock checks the same rules.
 */
export const adjustStockSchema = z
  .strictObject({
    set: z
      .number('set must be a number.')
      .int('Stock must be a whole number.')
      .min(0, 'Stock cannot be negative.')
      .max(stockMax, `Stock must be at most ${stockMax}.`)
      .optional(),
    adjust: z
      .number('adjust must be a number.')
      .int('An adjustment must be a whole number.')
      .min(-stockMax, `An adjustment must be at least -${stockMax}.`)
      .max(stockMax, `An adjustment must be at most ${stockMax}.`)
      .refine((value) => value !== 0, 'An adjustment cannot be 0.')
      .optional(),
    untracked: z.literal(true, 'untracked must be true.').optional(),
    reason: z.enum(STOCK_REASONS, 'reason must be MANUAL_SET, MANUAL_ADJUST or WASTE.').optional(),
  })
  .refine(
    (input) =>
      [input.set, input.adjust, input.untracked].filter((value) => value !== undefined).length ===
      1,
    { message: 'Send exactly one of set, adjust or untracked.', path: ['set'] },
  )
  .refine(
    ({ reason, adjust }) =>
      reason === undefined ||
      (adjust === undefined
        ? reason === 'MANUAL_SET'
        : reason === 'MANUAL_ADJUST' || (reason === 'WASTE' && adjust < 0)),
    { message: 'That reason does not fit this change.', path: ['reason'] },
  );

export const stockMovementsQuerySchema = z.strictObject({
  itemId: z.uuid('itemId must be a UUID.').optional(),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type StockMovementsQuery = z.infer<typeof stockMovementsQuerySchema>;
