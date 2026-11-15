import { ApiError } from '../../services/api';
import type { StoreProfileInput } from '../../services/manageStores';
import type { ManagedStore } from '../../types/api';

/** The API's refusal as field errors (`details.field`), or one message for the form. */
export function fieldErrorsOf(err: unknown): {
  fields: Record<string, string>;
  form: string | null;
} {
  if (err instanceof ApiError && err.details?.field)
    return { fields: { [err.details.field]: err.message }, form: null };
  return {
    fields: {},
    form: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
  };
}

export const toProfileDraft = (s: ManagedStore) => ({
  name: s.name,
  tagline: s.tagline,
  description: s.description,
  area: s.area ?? '',
  addressLine: s.address ?? '',
  contactPhone: s.contactPhone ?? '',
});
export type ProfileDraft = ReturnType<typeof toProfileDraft>;

const KEYS = ['name', 'tagline', 'description', 'area', 'addressLine', 'contactPhone'] as const;

/**
 * Only what the person changed since `before` (the store as last loaded or saved, never a later refresh: a field they
 * did not touch must not overwrite someone else's change). A blank place or phone is sent as null (cleared).
 */
export function profileChanges(before: ProfileDraft, draft: ProfileDraft): StoreProfileInput {
  const changes: StoreProfileInput = {};
  for (const key of KEYS) {
    const value = draft[key].trim();
    if (value === before[key].trim()) continue;
    const clearable = key === 'area' || key === 'addressLine' || key === 'contactPhone';
    Object.assign(changes, { [key]: clearable && value === '' ? null : value });
  }
  return changes;
}

/** A refreshed store into the form: fields the person has not touched take the new value; edited ones are kept. */
export const reconcileDraft = (
  draft: ProfileDraft,
  before: ProfileDraft,
  next: ProfileDraft,
): ProfileDraft =>
  Object.fromEntries(
    KEYS.map((k) => [k, draft[k] === before[k] ? next[k] : draft[k]]),
  ) as ProfileDraft;
