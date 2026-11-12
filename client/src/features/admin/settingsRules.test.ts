import { describe, expect, it } from 'vitest';
import {
  SETTING_FIELDS,
  SETTING_KEYS,
  changedSettings,
  settingHint,
  toDraft,
  validateSetting,
} from './settingsRules';
import type { SiteSettings } from '../../types/api';

const saved: SiteSettings = {
  customerOrderHistoryLimit: 20,
  staffOrderListLimit: 100,
  maxLinesPerOrder: 30,
  orderPollMs: 4000,
  ordersPollMs: 8000,
  staffBoardPollMs: 4000,
  clientErrorSamplePercent: 100,
  minClientVersion: '0.0.0',
  updatedAt: '2026-09-27T00:00:00Z',
};

describe('SETTING_FIELDS', () => {
  it('covers every editable SiteSettings field', () => {
    expect(SETTING_KEYS.sort()).toEqual(
      Object.keys(saved)
        .filter((k) => k !== 'updatedAt' && k !== 'staffOrderListLimit')
        .sort(),
    );
  });

  it('mirrors the API bounds', () => {
    expect(SETTING_FIELDS.maxLinesPerOrder).toMatchObject({ min: 1, max: 100 });
    expect(SETTING_FIELDS.orderPollMs).toMatchObject({ min: 2000, max: 60_000 });
    expect(SETTING_FIELDS.minClientVersion.kind).toBe('semver');
    expect(SETTING_FIELDS.clientErrorSamplePercent).toMatchObject({ min: 0, max: 100 });
  });
});

describe('validateSetting', () => {
  it('gives a negative number the range message, not "whole number"', () => {
    expect(validateSetting('customerOrderHistoryLimit', '-5')).toBe('Must be between 1 and 200.');
    expect(validateSetting('customerOrderHistoryLimit', '2.5')).toBe('Enter a whole number.');
  });

  it('accepts whole numbers within the bounds, including the edges', () => {
    expect(validateSetting('customerOrderHistoryLimit', '1')).toBeNull();
    expect(validateSetting('customerOrderHistoryLimit', '200')).toBeNull();
    expect(validateSetting('maxLinesPerOrder', ' 100 ')).toBeNull();
    expect(validateSetting('orderPollMs', '2000')).toBeNull();
    expect(validateSetting('staffBoardPollMs', '60000')).toBeNull();
    expect(validateSetting('clientErrorSamplePercent', '0')).toBeNull();
    expect(validateSetting('clientErrorSamplePercent', '100')).toBeNull();
  });

  it('rejects out-of-range, fractional, negative and non-numeric input', () => {
    expect(validateSetting('customerOrderHistoryLimit', '0')).toBe('Must be between 1 and 200.');
    expect(validateSetting('customerOrderHistoryLimit', '201')).toBe('Must be between 1 and 200.');
    expect(validateSetting('maxLinesPerOrder', '101')).toBe('Must be between 1 and 100.');
    expect(validateSetting('ordersPollMs', '1999')).toBe('Must be between 2000 and 60000.');
    expect(validateSetting('clientErrorSamplePercent', '101')).toBe('Must be between 0 and 100.');
    expect(validateSetting('clientErrorSamplePercent', '-1')).toBe('Must be between 0 and 100.');
    for (const raw of ['', '2.5', 'abc', '1e2', '--3']) {
      expect(validateSetting('maxLinesPerOrder', raw)).toBe('Enter a whole number.');
    }
    // A negative number is a whole number out of range: say the range.
    expect(validateSetting('maxLinesPerOrder', '-3')).toBe('Must be between 1 and 100.');
  });

  it('accepts only a plain x.y.z version for the minimum app version', () => {
    expect(validateSetting('minClientVersion', '1.2.3')).toBeNull();
    for (const raw of ['1.2', '1.2.3-beta', 'v1.2.3', '']) {
      expect(validateSetting('minClientVersion', raw)).toBe('Enter a version like 1.2.3.');
    }
  });
});

describe('toDraft and settingHint', () => {
  it('turns every setting into text', () => {
    expect(toDraft(saved)).toMatchObject({ orderPollMs: '4000', minClientVersion: '0.0.0' });
  });

  it('adds the range to integer hints only', () => {
    expect(settingHint('maxLinesPerOrder')).toMatch(/\(1\u2060–\u2060100\)$/);
    expect(settingHint('minClientVersion')).not.toMatch(/–/);
  });
});

describe('changedSettings', () => {
  it('sends only the fields that differ from what is saved, typed for the API', () => {
    expect(changedSettings(saved, toDraft(saved))).toEqual({});
    expect(
      changedSettings(saved, {
        ...toDraft(saved),
        customerOrderHistoryLimit: '25',
        minClientVersion: ' 0.2.0 ',
      }),
    ).toEqual({ customerOrderHistoryLimit: 25, minClientVersion: '0.2.0' });
  });
});
