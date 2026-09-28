import { describe, expect, it } from 'vitest';
import { registerSchema } from '../../src/schemas/auth.schema';
import { phoneField } from '../../src/schemas/common';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  updateOrderStatusSchema,
} from '../../src/schemas/order.schema';

const validOrder = {
  items: [{ menuItemId: 'item-1', quantity: 1 }],
  customerPhone: undefined,
  note: undefined,
};

describe('registerSchema', () => {
  const base = { name: 'Ann', email: 'ann@example.test', password: 'pw123456' };

  it.each([
    ['1 char', 1, false],
    ['2 chars (min)', 2, true],
    ['60 chars (max)', 60, true],
    ['61 chars', 61, false],
  ])('name at %s -> ok=%s', (_label, length, ok) => {
    const name = 'a'.repeat(length as number);
    expect(registerSchema.safeParse({ ...base, name }).success).toBe(ok as boolean);
  });

  it.each([
    ['5 chars', 5, false],
    ['6 chars (min)', 6, true],
    ['72 chars (max)', 72, true],
    ['73 chars', 73, false],
  ])('password at %s -> ok=%s', (_label, length, ok) => {
    const password = 'a'.repeat(length as number);
    expect(registerSchema.safeParse({ ...base, password }).success).toBe(ok as boolean);
  });

  it('rejects an invalid email', () => {
    expect(registerSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
  });

  it('lowercases a mixed-case email', () => {
    const result = registerSchema.safeParse({ ...base, email: 'Ann@Example.TEST' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('ann@example.test');
  });

  it('trims the name and treats a blank phone as not provided', () => {
    const result = registerSchema.safeParse({ ...base, name: '  Ann  ', phone: '   ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Ann');
      expect(result.data.phone).toBeUndefined();
    }
  });
});

describe('phoneField (shared by register and orders)', () => {
  it.each([
    ['blank -> undefined', '', true],
    ['normalises spaces/dashes/parens', '98765 43210', true],
    ['9 digits (too short)', '987654321', false],
    ['16 digits (too long)', '9876543210123456', false],
    ['letters', 'abcdefghij', false],
    ['leading + with 10 digits', '+9198765432', true],
  ])('%s', (_label, value, ok) => {
    expect(phoneField.safeParse(value).success).toBe(ok as boolean);
  });

  it('strips separators before storing', () => {
    const result = phoneField.safeParse('987-654 (3210)');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('9876543210');
  });
});

describe('createOrderSchema', () => {
  it.each([
    ['0 lines', 0, false],
    ['30 lines', 30, true],
    ['100 lines (the hard cap; the site setting is checked by createOrder)', 100, true],
    ['101 lines', 101, false],
  ])('items of %s -> ok=%s', (_label, count, ok) => {
    const items = Array.from({ length: count as number }, (_, i) => ({
      menuItemId: `item-${i}`,
      quantity: 1,
    }));
    expect(createOrderSchema.safeParse({ ...validOrder, items }).success).toBe(ok as boolean);
  });

  it.each<[string, unknown]>([
    ['quantity 0', 0],
    ['quantity 1.5 (not an integer)', 1.5],
    ['quantity "2" (string, not a number)', '2'],
  ])('%s is rejected', (_label, quantity) => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      items: [{ menuItemId: 'item-1', quantity }],
    });
    expect(result.success).toBe(false);
  });

  it('merges duplicate menuItemId lines by summing quantity', () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      items: [
        { menuItemId: 'item-1', quantity: 10 },
        { menuItemId: 'item-1', quantity: 11 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // 21 > MAX_QUANTITY_PER_ITEM (10): the merged line is what order.service later refuses.
      expect(result.data.items).toEqual([{ menuItemId: 'item-1', quantity: 21 }]);
      // The lines limit counts what was sent, before the merge.
      expect(result.data.lineCount).toBe(2);
    }
  });

  it.each([
    ['note at 200 chars (max)', 200, true],
    ['note at 201 chars', 201, false],
  ])('%s', (_label, length, ok) => {
    const note = 'a'.repeat(length as number);
    expect(createOrderSchema.safeParse({ ...validOrder, note }).success).toBe(ok as boolean);
  });

  it.each([
    ['customerName at 60 chars (max)', 60, true],
    ['customerName at 61 chars', 61, false],
  ])('%s', (_label, length, ok) => {
    const customerName = 'a'.repeat(length as number);
    expect(createOrderSchema.safeParse({ ...validOrder, customerName }).success).toBe(
      ok as boolean,
    );
  });

  it('rejects wrong types outright: items as a string, quantity null', () => {
    expect(createOrderSchema.safeParse({ ...validOrder, items: 'x' }).success).toBe(false);
    expect(
      createOrderSchema.safeParse({
        ...validOrder,
        items: [{ menuItemId: 'item-1', quantity: null }],
      }).success,
    ).toBe(false);
  });

  it('rejects an empty body', () => {
    expect(createOrderSchema.safeParse({}).success).toBe(false);
  });

  it('strips unknown keys (price, unitPrice, total) instead of rejecting them', () => {
    const result = createOrderSchema.safeParse({
      ...validOrder,
      price: 1,
      unitPrice: 1,
      total: 999999,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('price');
      expect(result.data).not.toHaveProperty('unitPrice');
      expect(result.data).not.toHaveProperty('total');
    }
  });

  it('a NUL byte in note is validation input, not something the schema strips itself (that is validate.ts)', () => {
    // The schema alone accepts a NUL byte; stripping happens in middleware/validate.ts before safeParse.
    expect(createOrderSchema.safeParse({ ...validOrder, note: 'a\u0000b' }).success).toBe(true);
  });
});

describe('updateOrderStatusSchema / listOrdersQuerySchema', () => {
  it('rejects a status outside the enum on the PATCH body', () => {
    expect(updateOrderStatusSchema.safeParse({ status: 'BOGUS' }).success).toBe(false);
    expect(updateOrderStatusSchema.safeParse({ status: 'PLACED' }).success).toBe(true);
  });

  it('rejects a status outside the enum on ?status=', () => {
    expect(listOrdersQuerySchema.safeParse({ status: 'BOGUS' }).success).toBe(false);
    expect(listOrdersQuerySchema.safeParse({ status: 'READY' }).success).toBe(true);
  });

  it('?status= is optional', () => {
    expect(listOrdersQuerySchema.safeParse({}).success).toBe(true);
  });
});
