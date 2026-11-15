import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
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
  // Held here, not in the form: a save changes updatedAt, which remounts the form with the saved values.
  const [savedAt, setSavedAt] = useState<string | null>(null);

  return (
    <div className="space-y-4 pt-4 animate-fade-up">
      <div>
        <h2 className="text-xl font-extrabold">Site settings</h2>
        <p className="mt-1 text-sm text-muted">
          Apply to every store. Changes take effect on the next request.
        </p>
      </div>
      {isLoading ? (
        <Card as="section" padding="lg" aria-busy aria-label="Loading settings">
          <div className="space-y-5">
            {SETTING_KEYS.map((key) => (
              <div key={key}>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-11 w-full rounded-control" />
              </div>
            ))}
          </div>
        </Card>
      ) : error || !settings ? (
        <ErrorState
          unreachable={error?.isUnreachable}
          code={error?.code}
          title="Settings didn't load"
          message={error?.message}
          onRetry={retry}
        />
      ) : (
        <SettingsForm
          key={settings.updatedAt}
          settings={settings}
          justSaved={savedAt === settings.updatedAt}
          onSaved={(saved) => {
            setSavedAt(saved.updatedAt);
            mutate(() => saved);
          }}
        />
      )}
    </div>
  );
}

function SettingsForm({
  settings,
  justSaved,
  onSaved,
}: {
  settings: SiteSettings;
  /** This form was just remounted by a successful save: confirm it and keep keyboard focus. */
  justSaved: boolean;
  onSaved: (settings: SiteSettings) => void;
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const savedRef = useRef<HTMLParagraphElement>(null);
  // Save turns disabled once nothing differs, which would drop keyboard focus: it moves to the confirmation.
  useEffect(() => {
    if (justSaved) savedRef.current?.focus();
  }, [justSaved]);

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
            onChange={(event) => {
              setEdited(true);
              setDraft((d) => ({ ...d, [key]: event.target.value }));
            }}
          />
        ))}
        {saveError && (
          <p role="alert" className="text-sm font-semibold text-brand-700">
            {saveError}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line/70 pt-4">
          {justSaved && !edited ? (
            <p
              ref={savedRef}
              tabIndex={-1}
              role="status"
              className="inline-flex items-center gap-1.5 text-caption font-semibold text-success-700 focus:outline-none"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden /> Saved
            </p>
          ) : (
            <p className="text-caption text-muted">
              Last saved <TimeText iso={settings.updatedAt} withDay />
            </p>
          )}
          <Button type="submit" loading={saving} disabled={!valid || !dirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
