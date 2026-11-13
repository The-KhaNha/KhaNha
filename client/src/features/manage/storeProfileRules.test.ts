import { describe, expect, it } from 'vitest';
import type { ManagedStore } from '../../types/api';
import { profileChanges, toProfileDraft } from './storeProfileRules';

const saved = {
  name: 'North',
  tagline: 'Hot chai',
  description: '',
  area: 'Campus',
  address: '1 Road',
  contactPhone: null,
} as ManagedStore;

describe('profileChanges', () => {
  it('sends only what changed, trimmed', () => {
    expect(profileChanges(saved, { ...toProfileDraft(saved), tagline: ' Cold coffee ' })).toEqual({
      tagline: 'Cold coffee',
    });
    expect(profileChanges(saved, { ...toProfileDraft(saved), name: 'North ' })).toEqual({});
  });

  it('a blanked place or phone is sent as null (cleared); a blank tagline as empty text', () => {
    expect(profileChanges(saved, { ...toProfileDraft(saved), area: '  ', tagline: '' })).toEqual({
      area: null,
      tagline: '',
    });
  });
});
