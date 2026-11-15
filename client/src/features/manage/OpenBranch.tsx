import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Input } from '../../components/Input';
import { VALIDATION } from '../config/fallbacks';
import { openBranch } from '../../services/manageStores';
import type { ManagedStore } from '../../types/api';
import { fieldErrorsOf } from './storeProfileRules';

const { nameMin, nameMax, slugMax, areaMax, addressMax } = VALIDATION.store;

interface OpenBranchProps {
  brandId: string;
  onOpened: (store: ManagedStore) => void;
  onCancel: () => void;
}

/** "Open a branch": a DRAFT copy of the brand's template. The server makes the web address when it is left blank. */
export function OpenBranch({ brandId, onOpened, onCancel }: OpenBranchProps) {
  const [draft, setDraft] = useState({ name: '', slug: '', area: '', addressLine: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameError =
    draft.name.trim().length < nameMin ? `Use at least ${nameMin} characters.` : undefined;

  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [key]: e.target.value }));
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setFormError(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (nameError || busy) return setErrors((e) => ({ ...e, name: nameError ?? '' }));
    setBusy(true);
    try {
      const trim = (v: string) => v.trim() || undefined;
      onOpened(
        await openBranch(brandId, {
          name: draft.name.trim(),
          slug: trim(draft.slug),
          area: trim(draft.area),
          addressLine: trim(draft.addressLine),
        }),
      );
    } catch (err) {
      const { fields, form } = fieldErrorsOf(err);
      setErrors(fields);
      setFormError(form);
      setBusy(false);
    }
  }

  return (
    <Card as="section" padding="lg" className="mt-2">
      <form onSubmit={submit} noValidate className="space-y-4" aria-label="Open a branch">
        <Input
          label="Branch name"
          value={draft.name}
          maxLength={nameMax}
          autoFocus
          error={errors.name || undefined}
          onChange={set('name')}
        />
        <Input
          label="Web address"
          hint="Optional: made from the name"
          value={draft.slug}
          maxLength={slugMax}
          autoCapitalize="none"
          error={errors.slug}
          onChange={set('slug')}
        />
        <Input
          label="Area"
          hint="Optional"
          value={draft.area}
          maxLength={areaMax}
          error={errors.area}
          onChange={set('area')}
        />
        <Input
          label="Address"
          hint="Optional"
          value={draft.addressLine}
          maxLength={addressMax}
          error={errors.addressLine}
          onChange={set('addressLine')}
        />
        <p className="text-caption text-muted">
          It starts as a draft with the brand template's menu and settings. Nobody sees it until you
          publish it.
        </p>
        {formError && (
          <p role="alert" className="text-sm font-semibold text-brand-700">
            {formError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Open the branch
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
