// User-facing wording that zod 4 could silently change: pinned through describeIssue.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { describeIssue } from '../../src/middleware/validate';
import { registerSchema } from '../../src/schemas/auth.schema';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  updateOrderStatusSchema,
} from '../../src/schemas/order.schema';

function message(schema: z.ZodType, input: unknown, source: 'body' | 'query' = 'body'): string {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return describeIssue(result.error?.issues[0], source);
}

const items = [{ menuItemId: 'a', quantity: 1 }];
const reg = { name: 'Ann', email: 'ann@example.test', password: 'pw123456' };

describe('user-facing validation wording', () => {
  it('names the allowed statuses on an unknown status (body and query)', () => {
    const want = 'Status must be one of PLACED, PREPARING, READY, COLLECTED, CANCELLED.';
    expect(message(updateOrderStatusSchema, { status: 'DONE' })).toBe(want);
    expect(message(listOrdersQuerySchema, { status: 'x' }, 'query')).toBe(want);
  });

  it('keeps the idempotencyKey UUID message', () => {
    expect(message(createOrderSchema, { items, idempotencyKey: 'nope' })).toBe(
      'idempotencyKey must be a UUID.',
    );
  });

  it('keeps the email message, and says "required" for a missing one', () => {
    expect(message(registerSchema, { ...reg, email: 'not-an-email' })).toBe(
      'Please enter a valid email address.',
    );
    expect(message(registerSchema, { name: 'Ann', password: 'pw123456' })).toBe(
      'Email is required.',
    );
  });

  it('missing vs wrong-typed fields', () => {
    expect(message(createOrderSchema, {})).toBe('Items is required.');
    expect(message(createOrderSchema, { items: 'x' })).toBe('Items is invalid.');
    // A missing status is "required", as with zod 3; a wrong one names the allowed statuses (above).
    expect(message(updateOrderStatusSchema, {})).toBe('Status is required.'); // as with zod 3
  });
});
