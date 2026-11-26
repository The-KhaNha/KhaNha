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

// Groups of 1–4 options, most available, with whole-rupee deltas and a valid min/max.
const groupArb = (index: number) =>
  fc
    .record({
      options: fc.array(
        fc.record({
          delta: fc.integer({ min: -50, max: 50 }).map((r) => r * 100),
          isAvailable: fc.integer({ min: 0, max: 5 }).map((n) => n > 0),
        }),
        { minLength: 1, maxLength: 4 },
      ),
      max: fc.integer({ min: 1, max: 4 }),
      min: fc.integer({ min: 0, max: 4 }),
      defaultAt: fc.option(fc.nat(3), { nil: undefined }),
    })
    .map(({ options, max, min, defaultAt }): PricingGroup => {
      const maxSelect = Math.min(max, options.length);
      return {
        id: `g${index}`,
        name: `Group ${index}`,
        minSelect: Math.min(min, maxSelect),
        maxSelect,
        options: options.map((o, i) => ({
          id: `g${index}-o${i}`,
          name: `Option ${i}`,
          priceDeltaPaise: o.delta,
          isDefault: i === defaultAt,
          isAvailable: o.isAvailable,
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
      // A line may also repeat an option or name one that is not on the item (another item's, a made-up id).
      extra: fc.constantFrom('none', 'none', 'duplicate', 'foreign'),
    }),
  );

interface Menu {
  groups: PricingGroup[];
  base: number;
  picks: number[];
  extra: string;
}
const chosenOf = ({ groups, picks, extra }: Menu): string[] => {
  const ids = groups.flatMap((g, i) => g.options.slice(0, picks[i]).map((o) => o.id));
  if (extra === 'duplicate' && ids[0]) ids.push(ids[0]);
  if (extra === 'foreign') ids.push('another-items-option');
  return ids;
};

type Expected = { ok: true; total: number } | { ok: false; code: string };

/**
 * What the pricing rules say, written out from the documented rules in domain/pricing.ts rather than by calling it:
 * the outcome and the price, computed from the generated groups and the chosen ids.
 */
function reference(m: Menu, chosenIds: string[]): Expected {
  const options = new Map(m.groups.flatMap((g) => g.options.map((o) => [o.id, o] as const)));
  if (new Set(chosenIds).size !== chosenIds.length) return { ok: false, code: 'MODIFIER_INVALID' };
  for (const id of chosenIds) {
    const o = options.get(id);
    if (!o || !o.isAvailable) return { ok: false, code: 'MODIFIER_INVALID' };
  }
  let total = m.base;
  for (const g of m.groups) {
    let picked = g.options.filter((o) => chosenIds.includes(o.id));
    // A required group left empty takes its available defaults, at most max.
    if (picked.length === 0 && g.minSelect > 0)
      picked = g.options.filter((o) => o.isDefault && o.isAvailable).slice(0, g.maxSelect);
    if (picked.length > g.maxSelect) return { ok: false, code: 'MODIFIER_INVALID' };
    if (picked.length < g.minSelect) return { ok: false, code: 'MODIFIER_REQUIRED' };
    total += picked.reduce((sum, o) => sum + o.priceDeltaPaise, 0);
  }
  return total < 0 ? { ok: false, code: 'MODIFIER_INVALID' } : { ok: true, total };
}

describe('priceLine: properties', () => {
  it('a line costs the item plus the deltas of the options it chose, and is refused exactly when the rules say', () => {
    fc.assert(
      fc.property(menuArb, (m) => {
        const got = priceLine(m.base, m.groups, chosenOf(m), true);
        const want = reference(m, chosenOf(m));
        if (want.ok) expect(got).toMatchObject({ ok: true, unitPricePaise: want.total });
        else expect(got).toMatchObject({ ok: false, code: want.code });
      }),
      { numRuns: 500 },
    );
  });

  it('an unavailable, repeated or foreign option is always refused as MODIFIER_INVALID', () => {
    fc.assert(
      fc.property(menuArb, (m) => {
        const bad = [
          ...m.groups.flatMap((g) => g.options.filter((o) => !o.isAvailable).map((o) => o.id)),
          'another-items-option',
        ];
        for (const id of bad)
          expect(priceLine(m.base, m.groups, [id], true)).toMatchObject({
            ok: false,
            code: 'MODIFIER_INVALID',
          });
        const [first] = m.groups.flatMap((g) => g.options.filter((o) => o.isAvailable));
        if (first)
          expect(priceLine(m.base, m.groups, [first.id, first.id], true)).toMatchObject({
            ok: false,
            code: 'MODIFIER_INVALID',
          });
      }),
    );
  });

  it('every accepted line keeps each group within min and max; every chosen option is applied', () => {
    fc.assert(
      fc.property(menuArb, (m) => {
        const chosen = chosenOf(m);
        const got = priceLine(m.base, m.groups, chosen, true);
        if (!got.ok) return;
        for (const g of m.groups) {
          const n = got.applied.filter((a) => a.groupName === g.name).length;
          expect(n).toBeGreaterThanOrEqual(g.minSelect);
          expect(n).toBeLessThanOrEqual(g.maxSelect);
        }
        for (const id of chosen) expect(got.applied.some((a) => a.optionId === id)).toBe(true);
      }),
    );
  });

  it('with the flag off, a line without options is the item price and one that names an option is refused', () => {
    fc.assert(
      fc.property(menuArb, (m) => {
        expect(priceLine(m.base, m.groups, [], false)).toEqual({
          ok: true,
          unitPricePaise: m.base,
          basePricePaise: m.base,
          applied: [],
        });
        expect(priceLine(m.base, m.groups, chosenOf({ ...m, extra: 'foreign' }), false)).toEqual({
          ok: false,
          code: 'MODIFIER_INVALID',
          groupName: undefined,
        });
      }),
    );
  });
});
