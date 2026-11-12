import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { Input } from '../components/Input';
import { Skeleton } from '../components/Skeleton';
import {
  STORE_SETTING_FIELDS,
  STORE_SETTING_KEYS,
  changedStoreSettings,
  toStoreDraft,
  validateStoreSetting,
} from '../features/manage/storeSettingsRules';
import { useResource } from '../lib/useResource';
import { ApiError } from '../services/api';
import { fetchStoreSettings, updateStoreSettings } from '../services/manage';
import type { StoreSettings } from '../types/api';

/** `/manage/:storeSlug/settings`: the store's four limits. Not persisted: it is the manager's own data. */
export function ManageSettingsTab({ storeId }: { storeId: string }) {
  const { data, isLoading, error, reload, mutate } = useResource(
    () => fetchStoreSettings(storeId),
    {
      key: `manage:settings:${storeId}`,
    },
  );
  if (isLoading)
    return (
      <Card as="section" padding="lg" className="mt-4" aria-busy aria-label="Loading settings">
        <Skeleton className="h-11 w-full rounded-control" />
      </Card>
    );
  if (error || !data)
    return (
      <ErrorState
        compact
        unreachable={error?.isUnreachable}
        title="Settings didn't load"
        message={error?.message}
        onRetry={reload}
      />
    );
  return <SettingsForm storeId={storeId} settings={data} onSaved={(s) => mutate(() => s)} />;
}

function SettingsForm({
  storeId,
  settings,
  onSaved,
}: {
  storeId: string;
  settings: StoreSettings;
  onSaved: (s: StoreSettings) => void;
}) {
  const [draft, setDraft] = useState(() => toStoreDraft(settings));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const valid = STORE_SETTING_KEYS.every((k) => validateStoreSetting(draft[k]) === null);
  const changes = valid ? changedStoreSettings(settings, draft) : {};
  const dirty = Object.keys(changes).length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      onSaved(await updateStoreSettings(storeId, changes));
      setSaved(true);
    } catch (err) {
      // A 400 carries the API's own bounds ("must be between 1 and 50"): shown as it is.
      setSaveError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" padding="lg" className="mt-4">
      <form onSubmit={submit} noValidate className="space-y-5">
        {STORE_SETTING_KEYS.map((key) => (
          <Input
            key={key}
            label={STORE_SETTING_FIELDS[key].label}
            hint={STORE_SETTING_FIELDS[key].hint}
            hintPlacement="below"
            inputMode="numeric"
            value={draft[key]}
            error={validateStoreSetting(draft[key]) ?? undefined}
            onChange={(e) => {
              setSaved(false);
              setDraft((d) => ({ ...d, [key]: e.target.value }));
            }}
          />
        ))}
        {saveError && (
          <p role="alert" className="text-sm font-semibold text-brand-700">
            {saveError}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line/70 pt-4">
          <p role="status" className="text-caption font-semibold text-success-700">
            {saved ? 'Saved' : ''}
          </p>
          <Button type="submit" loading={saving} disabled={!valid || !dirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
