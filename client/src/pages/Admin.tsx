import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { Input } from '../components/Input';
import { Skeleton } from '../components/Skeleton';
import { TimeText } from '../components/TimeText';
import {
  SETTING_FIELDS,
  SETTING_KEYS,
  changedSettings,
  settingHint,
  toDraft,
  validateSetting,
  type SettingsDraft,
} from '../features/admin/settingsRules';
import { useSiteSettings } from '../features/admin/useSiteSettings';
import { ApiError } from '../services/api';
import { updateSiteSettings } from '../services/admin';
import type { SiteSettings } from '../types/api';

/** Site-wide admin dashboard (developer/operator, not the restaurant): everything in site_settings. */
export function AdminPage() {
  const { settings, isLoading, error, retry, mutate } = useSiteSettings();

  return (
    <div className="space-y-4 pt-4 animate-fade-up">
      <div>
        <h2 className="text-xl font-extrabold">Site settings</h2>
        <p className="mt-1 text-sm text-muted">
          Apply to every store. Changes take effect on the next request.
        </p>
      </div>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-[20px]" />
      ) : error || !settings ? (
        <ErrorState
          unreachable={error?.isUnreachable}
          title="Settings didn't load"
          message={error?.message}
          onRetry={retry}
        />
      ) : (
        <SettingsForm
          key={settings.updatedAt}
          settings={settings}
          onSaved={(saved) => mutate(() => saved)}
        />
      )}
    </div>
  );
}

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: SiteSettings;
  onSaved: (settings: SiteSettings) => void;
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fieldErrors = Object.fromEntries(
    SETTING_KEYS.map((key) => [key, validateSetting(key, draft[key])]),
  );
  const valid = SETTING_KEYS.every((key) => fieldErrors[key] === null);
  const changes = valid ? changedSettings(settings, draft) : {};
  const dirty = Object.keys(changes).length > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      onSaved(await updateSiteSettings(changes));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" padding="lg">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {SETTING_KEYS.map((key) => (
          <Input
            key={key}
            label={SETTING_FIELDS[key].label}
            hint={settingHint(key)}
            hintPlacement="below"
            inputMode={SETTING_FIELDS[key].kind === 'integer' ? 'numeric' : 'decimal'}
            value={draft[key]}
            error={fieldErrors[key] ?? undefined}
            onChange={(event) => setDraft((d) => ({ ...d, [key]: event.target.value }))}
          />
        ))}
        {saveError && (
          <p role="alert" className="text-sm font-semibold text-brand-700">
            {saveError}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line/70 pt-4">
          <p className="text-[13px] text-muted">
            Last saved <TimeText iso={settings.updatedAt} withDay />
          </p>
          <Button type="submit" loading={saving} disabled={!valid || !dirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
