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

/** Only what changed; a blank place or phone is sent as null (cleared). */
export function profileChanges(saved: ManagedStore, draft: ProfileDraft): StoreProfileInput {
  const before = toProfileDraft(saved);
  const changes: StoreProfileInput = {};
  for (const key of Object.keys(draft) as (keyof ProfileDraft)[]) {
    const value = draft[key].trim();
    if (value === before[key].trim()) continue;
    const clearable = key === 'area' || key === 'addressLine' || key === 'contactPhone';
    Object.assign(changes, { [key]: clearable && value === '' ? null : value });
  }
  return changes;
}
