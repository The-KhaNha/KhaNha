import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input, Textarea } from '../components/Input';
import { VALIDATION } from '../features/config/fallbacks';
import {
  fieldErrorsOf,
  profileChanges,
  reconcileDraft,
  toProfileDraft,
  type ProfileDraft,
} from '../features/manage/storeProfileRules';
import { updateStoreProfile } from '../services/manageStores';
import type { ManagedStore } from '../types/api';

const { nameMax, taglineMax, descriptionMax, areaMax, addressMax } = VALIDATION.store;

/**
 * `/manage/:storeSlug/profile`: the name, tagline, description, place and phone customers see. Managers and the owner;
 * on the template, what new branches copy.
 */
export function ManageProfileTab({ store, onSaved }: { store: ManagedStore; onSaved: () => void }) {
  // `before` is the store as last loaded or saved: what the draft is compared with (CodeRabbit #88).
  const [before, setBefore] = useState(() => toProfileDraft(store));
  const [draft, setDraft] = useState(before);
  const [synced, setSynced] = useState(store);
  if (store !== synced) {
    // A refresh (someone else's save): untouched fields follow it; edited ones stay the person's.
    const next = toProfileDraft(store);
    setDraft(reconcileDraft(draft, before, next));
    setBefore(next);
    setSynced(store);
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const changes = profileChanges(before, draft);
  const dirty = Object.keys(changes).length > 0;

  const set = (key: keyof ProfileDraft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [key]: e.target.value }));
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setFormError(null);
    setSaved(false);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const saved = toProfileDraft(await updateStoreProfile(store.id, changes));
      setBefore(saved);
      setDraft(saved);
      setSaved(true);
      onSaved();
    } catch (err) {
      const { fields, form } = fieldErrorsOf(err);
      setErrors(fields);
      setFormError(form);
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof ProfileDraft, label: string, max?: number, hint?: string) => (
    <Input
      label={label}
      hint={hint}
      value={draft[key]}
      maxLength={max}
      disabled={saving}
      error={errors[key]}
      onChange={set(key)}
    />
  );

  return (
    <Card as="section" padding="lg" className="mt-4">
      <form onSubmit={submit} noValidate className="space-y-4" aria-label="Store profile">
        {field('name', 'Name', nameMax)}
        {field('tagline', 'Tagline', taglineMax, 'Optional')}
        <Textarea
          label="Description"
          hint="Optional"
          value={draft.description}
          maxLength={descriptionMax}
          disabled={saving}
          error={errors.description}
          onChange={set('description')}
        />
        {!store.isTemplate && (
          <>
            {field('area', 'Area', areaMax, 'Optional')}
            {field(
              'addressLine',
              'Address',
              addressMax,
              store.status === 'ACTIVE' ? undefined : 'Needed to publish',
            )}
            {field('contactPhone', 'Phone', undefined, 'Optional')}
          </>
        )}
        {formError && (
          <p role="alert" className="text-sm font-semibold text-brand-700">
            {formError}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line/70 pt-4">
          <p role="status" className="text-caption font-semibold text-success-700">
            {saved ? 'Saved' : ''}
          </p>
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
