import { describe, expect, it } from 'vitest';
import type { ManagedStore } from '../../types/api';
import { profileChanges, reconcileDraft, toProfileDraft } from './storeProfileRules';

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
    expect(
      profileChanges(toProfileDraft(saved), { ...toProfileDraft(saved), tagline: ' Cold coffee ' }),
    ).toEqual({
      tagline: 'Cold coffee',
    });
    expect(
      profileChanges(toProfileDraft(saved), { ...toProfileDraft(saved), name: 'North ' }),
    ).toEqual({});
  });

  it('a blanked place or phone is sent as null (cleared); a blank tagline as empty text', () => {
    expect(
      profileChanges(toProfileDraft(saved), { ...toProfileDraft(saved), area: '  ', tagline: '' }),
    ).toEqual({
      area: null,
      tagline: '',
    });
  });
});

describe('reconcileDraft', () => {
  it("a refresh moves untouched fields and keeps the person's edits", () => {
    const before = toProfileDraft(saved);
    const draft = { ...before, contactPhone: '9876543210' };
    const next = { ...before, name: 'South' };
    expect(reconcileDraft(draft, before, next)).toEqual({ ...next, contactPhone: '9876543210' });
  });
});
