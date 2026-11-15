import { describe, expect, it } from 'vitest';
import { paiseToRupees, rupeesToPaise } from '../../src/utils/money';

describe('paiseToRupees', () => {
  it('converts whole rupees', () => {
    expect(paiseToRupees(12000)).toBe(120);
    expect(paiseToRupees(0)).toBe(0);
  });

  it('refuses a part of a rupee rather than round it', () => {
    expect(() => paiseToRupees(4950)).toThrow(RangeError);
    expect(() => paiseToRupees(1.5)).toThrow(RangeError);
    expect(() => paiseToRupees(-4950)).toThrow(RangeError);
    expect(() => paiseToRupees(Number.NaN)).toThrow(RangeError);
    expect(() => paiseToRupees(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => paiseToRupees(200.5)).toThrow(RangeError);
  });

  it('keeps the sign of a whole negative rupee amount', () => {
    expect(paiseToRupees(-12000)).toBe(-120);
  });
});

describe('rupeesToPaise', () => {
  it('converts, and round-trips with paiseToRupees', () => {
    expect(rupeesToPaise(120)).toBe(12000);
    expect(paiseToRupees(rupeesToPaise(49))).toBe(49);
  });

  it('refuses an amount that is not a whole number of paise', () => {
    expect(() => rupeesToPaise(0.001)).toThrow(RangeError);
    expect(() => rupeesToPaise(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});
