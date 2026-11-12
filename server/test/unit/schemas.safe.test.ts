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
  it('refuses a password of only spaces, and keeps spaces inside one', () => {
    const base = { name: 'Ravi Kumar', email: 'ravi@example.com' };
    const spaces = registerSchema.safeParse({ ...base, password: '        ' });
    expect(spaces.success).toBe(false);
    expect(spaces.error?.issues[0]?.message).toBe('Password cannot be only spaces.');
    expect(registerSchema.safeParse({ ...base, password: 'open sesame' }).success).toBe(true);
  });

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
        { menuItemId: 'item-1', quantity: 10, expectedUnitPrice: 120 },
        { menuItemId: 'item-1', quantity: 11, expectedUnitPrice: 100 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // 21 > the store's cap (default 10): the merged line is what order.service later refuses. Every shown price is
      // kept, so a stale one on a duplicate line is still compared.
      expect(result.data.items).toEqual([
        { menuItemId: 'item-1', quantity: 21, expectedUnitPrices: [120, 100] },
      ]);
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

// Typed text (a name, a note) is checked as the browser counts it, so the API never refuses what a form accepted and
// never stores what a form would refuse (client/src/features/auth/validation.ts mirrors these rules).
describe('typed text: characters and length', () => {
  const register = { email: 'ann@example.test', password: 'pw123456' };
  const firstMessage = (result: { error?: { issues: { message: string }[] } }) =>
    result.error?.issues[0]?.message;

  // A lone surrogate reached place_order as JSON PostgREST could not read: a 500 after the payment ran.
  it.each([
    ['customerName', { customerName: 'x\ud800y' }],
    ['customerName (low surrogate)', { customerName: 'x\udfff' }],
    ['note', { note: 'x\ud800y' }],
  ])('refuses a lone surrogate in an order %s', (_label, fields) => {
    const result = createOrderSchema.safeParse({ ...validOrder, ...fields });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe('Invalid characters in input.');
  });

  it.each([
    ['name', { name: 'Br\ud800ker', password: 'pw123456' }],
    ['password', { name: 'Ann', password: 'pw12\udc003456' }],
  ])('refuses a lone surrogate in a register %s (it was stored as U+FFFD)', (_label, fields) => {
    const result = registerSchema.safeParse({ ...register, ...fields });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe('Invalid characters in input.');
  });

  it('keeps a whole surrogate pair: an emoji is well formed', () => {
    expect(createOrderSchema.safeParse({ ...validOrder, customerName: 'Ann 🍔' }).success).toBe(
      true,
    );
  });

  // trim() leaves format characters, the Braille blank and the Hangul fillers, so a name of them looked filled in.
  const invisibleOnly = [
    ['zero-width spaces', '\u200b\u200b\u200b'],
    ['a Braille blank and a Hangul filler', '\u2800\u3164'],
    ['Hangul choseong/jungseong fillers and halfwidth filler', '\u115f\u1160\uffa0'],
    ['a word joiner between spaces', ' \u2060 '],
    // Marks that draw nothing on their own: they are kept at the ends (trimming U+FE0F would break "\u2764\ufe0f"), so they are
    // counted as invisible instead.
    ['emoji variation selectors and a combining grapheme joiner', '\ufe0f\u034f\ufe0e'],
    ['an ideographic variation selector', '\u{e0100}\u{e01ef}'],
    ['Khmer inherent vowels and Mongolian variation selectors', '\u17b4\u17b5\u180b\u180c\u180d'],
    ['variation selectors around spaces', '\ufe0f  \ufe0f'],
    ['tag characters', '\u{e0067}\u{e0062}\u{e007f}'],
  ];

  it.each(invisibleOnly)('refuses a register name of %s', (_label, name) => {
    const result = registerSchema.safeParse({ ...register, name });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe('Name must be at least 2 characters.');
  });

  it.each(invisibleOnly)(
    'treats an order customerName of %s as not sent',
    (_label, customerName) => {
      const result = createOrderSchema.safeParse({
        ...validOrder,
        customerName,
        note: customerName,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customerName).toBeUndefined();
        expect(result.data.note).toBeUndefined();
      }
    },
  );

  it('counts only visible characters toward the minimum: one letter and a zero-width space is too short', () => {
    expect(registerSchema.safeParse({ ...register, name: 'A\u200b' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...register, name: 'A\ufe0f' }).success).toBe(false);
  });

  // A subdivision flag ends in tag characters (\p{Cf}) and a red heart in a variation selector: neither is padding.
  it.each([
    ['a Scotland flag', 'Ann \ud83c\udff4\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}'],
    ['a red heart', 'Ann \u2764\ufe0f'],
    ['a keycap', 'Table 1\ufe0f\u20e3'],
  ])('keeps %s at the end of a name or note intact', (_label, text) => {
    const registered = registerSchema.safeParse({ ...register, name: text });
    expect(registered.success && registered.data.name).toBe(text);
    const ordered = createOrderSchema.safeParse({ ...validOrder, customerName: text, note: text });
    expect(ordered.success && [ordered.data.customerName, ordered.data.note]).toEqual([text, text]);
  });

  it('trims invisibles at the ends but keeps a joiner inside a name or an emoji sequence', () => {
    const family = '👨\u200d👩\u200d👧';
    const result = registerSchema.safeParse({ ...register, name: `\u200b Ann ${family}\u200b ` });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe(`Ann ${family}`);
    // A zero-width non-joiner shapes Indic and Persian script: it stays where it was typed.
    const zwnj = registerSchema.safeParse({ ...register, name: 'ক\u200cষ' });
    expect(zwnj.success && zwnj.data.name).toBe('ক\u200cষ');
  });

  // zod's max() counts code points; the form's maxLength counts UTF-16 units, so 31 burgers (62 units) got through.
  it.each([
    ['customerName of 30 emoji (60 units)', { customerName: '🍔'.repeat(30) }, true],
    ['customerName of 31 emoji (62 units)', { customerName: '🍔'.repeat(31) }, false],
    ['note of 100 emoji (200 units)', { note: '🍔'.repeat(100) }, true],
    ['note of 101 emoji (202 units)', { note: '🍔'.repeat(101) }, false],
  ])('limits an order %s by UTF-16 units -> ok=%s', (_label, fields, ok) => {
    expect(createOrderSchema.safeParse({ ...validOrder, ...fields }).success).toBe(ok);
  });

  it.each([
    ['30 emoji (60 units)', '🍔'.repeat(30), true],
    ['31 emoji (62 units)', '🍔'.repeat(31), false],
    ['one emoji (2 units, the minimum)', '🍔', true],
  ])('limits a register name of %s by UTF-16 units -> ok=%s', (_label, name, ok) => {
    expect(registerSchema.safeParse({ ...register, name }).success).toBe(ok);
  });
});
