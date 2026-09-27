import { describe, expect, it } from 'vitest';
import { changedSettings, validateLimit } from './settingsRules';

const saved = {
  customerOrderHistoryLimit: 20,
  staffOrderListLimit: 100,
  minClientVersion: '0.0.0',
  updatedAt: '2026-09-27T00:00:00Z',
};

describe('validateLimit', () => {
  it('accepts whole numbers within the bounds, including the edges', () => {
    expect(validateLimit('customerOrderHistoryLimit', '1')).toBeNull();
    expect(validateLimit('customerOrderHistoryLimit', '200')).toBeNull();
    expect(validateLimit('staffOrderListLimit', ' 500 ')).toBeNull();
  });

  it('rejects out-of-range, fractional, negative and non-numeric input', () => {
    expect(validateLimit('customerOrderHistoryLimit', '0')).toBe('Must be between 1 and 200.');
    expect(validateLimit('customerOrderHistoryLimit', '201')).toBe('Must be between 1 and 200.');
    expect(validateLimit('staffOrderListLimit', '501')).toBe('Must be between 1 and 500.');
    for (const raw of ['', '2.5', '-3', 'abc', '1e2']) {
      expect(validateLimit('staffOrderListLimit', raw)).toBe('Enter a whole number.');
    }
  });
});

describe('changedSettings', () => {
  it('sends only the fields that differ from what is saved', () => {
    expect(
      changedSettings(saved, { customerOrderHistoryLimit: '20', staffOrderListLimit: '100' }),
    ).toEqual({});
    expect(
      changedSettings(saved, { customerOrderHistoryLimit: '25', staffOrderListLimit: '100' }),
    ).toEqual({
      customerOrderHistoryLimit: 25,
    });
  });
});
