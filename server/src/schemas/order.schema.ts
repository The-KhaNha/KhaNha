import { z } from 'zod';
import { ORDER_STATUSES } from '../types/enums';
import { optionalField, phoneField } from './common';
import { LIMITS } from './limits';

/** Most of one item in a single order, checked after duplicate lines are merged. */
export const MAX_QUANTITY_PER_ITEM = 10;
/**
 * A sanity bound only. The real limit is the site setting max_lines_per_order (1-100), enforced by createOrder,
 * so an admin can change it without a deploy.
 */
export const MAX_ITEM_LINES_HARD = 100;

const orderItemInput = z.object({
  menuItemId: z.string().min(1, 'Menu item id is required.'),
  quantity: z
    .number()
    .int('Quantity must be a whole number.')
    .min(1, 'Quantity must be at least 1.'),
});

type OrderItemInput = z.infer<typeof orderItemInput>;

/**
 * The same item listed twice becomes one line with the quantities summed, so the
 * per-item cap (enforced in order.service, where the item's name is known) applies to the total.
 */
function mergeDuplicateItems(items: OrderItemInput[]): OrderItemInput[] {
  const merged = new Map<string, number>();
  for (const { menuItemId, quantity } of items) {
    merged.set(menuItemId, (merged.get(menuItemId) ?? 0) + quantity);
  }
  return [...merged].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

/**
 * Unknown keys (price, unitPrice, total, ...) are stripped by z.object, so the
 * client can never influence what is charged. Prices come from the database only.
 */
export const createOrderSchema = z
  .object({
    items: z
      .array(orderItemInput)
      .min(1, 'Add at least one item to your order.')
      .max(MAX_ITEM_LINES_HARD, `An order can have at most ${MAX_ITEM_LINES_HARD} items.`),
    customerName: optionalField(
      z.string().trim().max(LIMITS.nameMax, `Name must be at most ${LIMITS.nameMax} characters.`),
    ),
    customerPhone: phoneField,
    note: optionalField(
      z.string().trim().max(LIMITS.noteMax, `Note must be at most ${LIMITS.noteMax} characters.`),
    ),
  })
  // Lines are counted as sent, before duplicates merge (docs/API.md): the lines limit applies to lineCount.
  .transform((input) => ({
    ...input,
    lineCount: input.items.length,
    items: mergeDuplicateItems(input.items),
  }));

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

const status = z.enum(ORDER_STATUSES, {
  errorMap: () => ({ message: `Status must be one of ${ORDER_STATUSES.join(', ')}.` }),
});

export const updateOrderStatusSchema = z.object({ status });

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const listOrdersQuerySchema = z.object({ status: status.optional() });

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
