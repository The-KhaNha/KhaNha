import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { priceLine, type PricingGroup } from '../../src/domain/pricing';
import { MODIFIER_CASES } from '../setup/modifierCases';

describe('priceLine: the shared case table', () => {
  it.each(MODIFIER_CASES)('$name', ({ basePricePaise, groups, chosen, enabled, expect: want }) => {
    const got = priceLine(basePricePaise, groups, chosen, enabled);
    if ('code' in want) expect(got).toMatchObject({ ok: false, ...want });
    else
      expect(got).toMatchObject({
        ok: true,
        unitPricePaise: want.unitPricePaise,
        basePricePaise,
        applied: want.options.map((optionName) => expect.objectContaining({ optionName })),
      });
  });
});

// Groups of 1–4 available options each, with whole-rupee deltas and a valid min/max.
const groupArb = (index: number) =>
  fc
    .record({
      deltas: fc.array(
        fc.integer({ min: -50, max: 50 }).map((r) => r * 100),
        {
          minLength: 1,
          maxLength: 4,
        },
      ),
      max: fc.integer({ min: 1, max: 4 }),
      min: fc.integer({ min: 0, max: 4 }),
      defaultAt: fc.option(fc.nat(3), { nil: undefined }),
    })
    .map(({ deltas, max, min, defaultAt }): PricingGroup => {
      const maxSelect = Math.min(max, deltas.length);
      return {
        id: `g${index}`,
        name: `Group ${index}`,
        minSelect: Math.min(min, maxSelect),
        maxSelect,
        options: deltas.map((priceDeltaPaise, i) => ({
          id: `g${index}-o${i}`,
          name: `Option ${i}`,
          priceDeltaPaise,
          isDefault: i === defaultAt,
          isAvailable: true,
        })),
      };
    });
const menuArb = fc
  .integer({ min: 0, max: 3 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => groupArb(i))))
  .chain((groups) =>
    fc.record({
      groups: fc.constant(groups),
      base: fc.integer({ min: 0, max: 1000 }).map((r) => r * 100),
      // A pick per group: how many of its options, from the front.
      picks: fc.tuple(...groups.map((g) => fc.integer({ min: 0, max: g.options.length }))),
    }),
  );

describe('priceLine: properties', () => {
  it('an accepted line costs the item plus exactly the applied deltas, and never less than zero', () => {
    fc.assert(
      fc.property(menuArb, ({ groups, base, picks }) => {
        const chosen = groups.flatMap((g, i) => g.options.slice(0, picks[i]).map((o) => o.id));
        const got = priceLine(base, groups, chosen, true);
        if (!got.ok) return;
        const sum = got.applied.reduce((s, m) => s + m.priceDeltaPaise, 0);
        expect(got.unitPricePaise).toBe(base + sum);
        expect(got.unitPricePaise).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('every accepted line keeps each group within min and max; every chosen option is applied', () => {
    fc.assert(
      fc.property(menuArb, ({ groups, base, picks }) => {
        const chosen = groups.flatMap((g, i) => g.options.slice(0, picks[i]).map((o) => o.id));
        const got = priceLine(base, groups, chosen, true);
        if (!got.ok) return;
        for (const g of groups) {
          const n = got.applied.filter((m) => m.groupName === g.name).length;
          expect(n).toBeGreaterThanOrEqual(g.minSelect);
          expect(n).toBeLessThanOrEqual(g.maxSelect);
        }
        for (const id of chosen) expect(got.applied.some((m) => m.optionId === id)).toBe(true);
      }),
    );
  });

  it('a group chosen within its bounds is never refused for its count', () => {
    fc.assert(
      fc.property(menuArb, ({ groups, base, picks }) => {
        const inBounds = groups.every((g, i) => {
          const n = picks[i] ?? 0;
          const defaults = g.options.filter((o) => o.isDefault).length;
          return (n >= g.minSelect || (n === 0 && defaults >= g.minSelect)) && n <= g.maxSelect;
        });
        const chosen = groups.flatMap((g, i) => g.options.slice(0, picks[i]).map((o) => o.id));
        const got = priceLine(base, groups, chosen, true);
        if (inBounds && !got.ok) expect(got.code).toBe('MODIFIER_INVALID'); // only a negative price
        if (inBounds && !got.ok) expect(got.groupName).toBeUndefined();
      }),
    );
  });

  it('with the flag off, any line without options is the item price', () => {
    fc.assert(
      fc.property(menuArb, ({ groups, base }) => {
        expect(priceLine(base, groups, [], false)).toEqual({
          ok: true,
          unitPricePaise: base,
          basePricePaise: base,
          applied: [],
        });
      }),
    );
  });
});
