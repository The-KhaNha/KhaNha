import { describe, expect, it } from 'vitest';
import type { ManagedStore } from '../../types/api';
import { ApiError } from '../../services/api';
import { fieldErrorsOf, profileChanges, reconcileDraft, toProfileDraft } from './storeProfileRules';

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

describe('fieldErrorsOf', () => {
  it('maps an API refusal about one field to that field', () => {
    expect(
      fieldErrorsOf(new ApiError(400, 'VALIDATION_ERROR', 'Too long', { field: 'tagline' })),
    ).toEqual({ fields: { tagline: 'Too long' }, form: null });
  });

  it('shows another API refusal as the form message', () => {
    expect(fieldErrorsOf(new ApiError(403, 'FORBIDDEN', 'Not allowed'))).toEqual({
      fields: {},
      form: 'Not allowed',
    });
  });

  it('shows a generic message for anything else', () => {
    expect(fieldErrorsOf(new Error('boom'))).toEqual({
      fields: {},
      form: 'Something went wrong. Please try again.',
    });
  });
});

describe('toProfileDraft', () => {
  it('turns a missing place, address or phone into empty text', () => {
    expect(toProfileDraft({ ...saved, area: null, address: null, contactPhone: null })).toEqual({
      name: 'North',
      tagline: 'Hot chai',
      description: '',
      area: '',
      addressLine: '',
      contactPhone: '',
    });
  });

  it('keeps the ones that are set', () => {
    expect(toProfileDraft({ ...saved, contactPhone: '9876543210' })).toMatchObject({
      area: 'Campus',
      addressLine: '1 Road',
      contactPhone: '9876543210',
    });
  });
});

describe('profileChanges (more)', () => {
  it('blanking an address or a phone clears it; blanking the name sends empty text', () => {
    const before = toProfileDraft({ ...saved, contactPhone: '9876543210' });
    expect(
      profileChanges(before, { ...before, addressLine: '', contactPhone: ' ', name: '' }),
    ).toEqual({ addressLine: null, contactPhone: null, name: '' });
  });

  it('an unchanged field whose saved value has stray spaces is not sent', () => {
    const before = { ...toProfileDraft(saved), tagline: 'Hot chai  ' };
    expect(profileChanges(before, { ...before, tagline: 'Hot chai' })).toEqual({});
  });
});
