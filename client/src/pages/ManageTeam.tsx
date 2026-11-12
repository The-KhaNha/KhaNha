import { useState, type FormEvent } from 'react';
import { Check, Copy, Share2, UsersRound } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Input } from '../components/Input';
import { Skeleton } from '../components/Skeleton';
import { TimeText } from '../components/TimeText';
import { canManageManagers, canRemoveMember } from '../features/manage/manageRules';
import { validateEmail } from '../features/auth/validation';
import { useResource } from '../lib/useResource';
import { ApiError } from '../services/api';
import { createInvite, fetchTeam, removeMember, revokeInvite } from '../services/manage';
import type { StoreRole, StoreSummary, User } from '../types/api';

type Pending = { kind: 'revoke' | 'remove'; id: string; label: string } | null;

/** `/manage/:storeSlug/team`: members, open invites, and inviting by email. */
export function ManageTeamTab({
  store,
  user,
}: {
  store: Pick<StoreSummary, 'id' | 'brand'>;
  user: User;
}) {
  const { data, isLoading, error, reload } = useResource(() => fetchTeam(store.id), {
    key: `manage:team:${store.id}`,
  });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StoreRole>('STAFF');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The one-time token lives in this component's state only: never a store, localStorage or sessionStorage.
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mayManageManagers = canManageManagers(user, store);

  async function invite(event: FormEvent) {
    event.preventDefault();
    const problem = validateEmail(email);
    if (problem) return setFormError(problem);
    setBusy(true);
    setFormError(null);
    try {
      const { token } = await createInvite(store.id, { email: email.trim(), role });
      setLink({ email: email.trim(), url: `${window.location.origin}/join#${token}` });
      setCopied(false);
      setEmail('');
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      await (pending.kind === 'revoke' ? revokeInvite : removeMember)(store.id, pending.id);
      setPending(null);
      reload();
    } catch (err) {
      setPending(null);
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <Card as="section" padding="lg">
        <h2 className="text-lg font-extrabold">Invite someone</h2>
        <form onSubmit={invite} noValidate className="mt-3 space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="off"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={formError ?? undefined}
          />
          <label className="block text-sm font-semibold">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StoreRole)}
              className="mt-1.5 min-h-11 w-full rounded-xl border bg-surface px-3 text-body"
            >
              <option value="STAFF">Staff</option>
              {mayManageManagers && <option value="MANAGER">Manager</option>}
            </select>
          </label>
          <Button type="submit" fullWidth loading={busy && !pending}>
            Create invite link
          </Button>
        </form>
        {link && (
          <div role="status" className="mt-4 space-y-2 rounded-card bg-surface-2 p-3">
            <p className="text-sm font-semibold">Link for {link.email}. It is shown only once.</p>
            <p className="break-all text-caption text-muted">{link.url}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => copy(link.url)}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {typeof navigator.share === 'function' && (
                <Button
                  variant="secondary"
                  onClick={() => navigator.share({ url: link.url }).catch(() => undefined)}
                >
                  <Share2 className="h-4 w-4" aria-hidden /> Share
                </Button>
              )}
              <Button variant="ghost" onClick={() => setLink(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Card>

      {actionError && (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {actionError}
        </p>
      )}

      {isLoading ? (
        <Card as="section" padding="lg" aria-busy aria-label="Loading the team">
          <Skeleton className="h-11 w-full rounded-control" />
        </Card>
      ) : error || !data ? (
        <ErrorState
          compact
          unreachable={error?.isUnreachable}
          title="The team didn't load"
          message={error?.message}
          onRetry={reload}
        />
      ) : (
        <>
          <Card as="section" padding="lg">
            <h2 className="text-lg font-extrabold">Team</h2>
            {data.members.length === 0 ? (
              <EmptyState
                icon={UsersRound}
                tone="neutral"
                title="No one yet"
                description="Invite someone above."
              />
            ) : (
              <ul className="mt-2 divide-y divide-line/70">
                {data.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="wrap-anywhere font-semibold">{m.name}</p>
                      <p className="wrap-anywhere text-caption text-muted">
                        {m.email} · {m.role === 'MANAGER' ? 'Manager' : 'Staff'}
                      </p>
                    </div>
                    {canRemoveMember(user, store, m) && (
                      <Button
                        variant="ghost-danger"
                        aria-label={`Remove ${m.name}`}
                        onClick={() => setPending({ kind: 'remove', id: m.id, label: m.name })}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {data.invites.length > 0 && (
            <Card as="section" padding="lg">
              <h2 className="text-lg font-extrabold">Open invites</h2>
              <ul className="mt-2 divide-y divide-line/70">
                {data.invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="wrap-anywhere font-semibold">{i.email}</p>
                      <p className="text-caption text-muted">
                        {i.role === 'MANAGER' ? 'Manager' : 'Staff'} · expires{' '}
                        <TimeText iso={i.expiresAt} withDay />
                      </p>
                    </div>
                    {(i.role === 'STAFF' || mayManageManagers) && (
                      <Button
                        variant="ghost-danger"
                        aria-label={`Revoke invite for ${i.email}`}
                        onClick={() => setPending({ kind: 'revoke', id: i.id, label: i.email })}
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {pending && (
        <ConfirmSheet
          title={pending.kind === 'remove' ? 'Remove from the team?' : 'Revoke this invite?'}
          text={
            pending.kind === 'remove'
              ? `${pending.label} loses access to this store at once.`
              : `The link sent to ${pending.label} stops working.`
          }
          confirmLabel={pending.kind === 'remove' ? 'Remove' : 'Revoke'}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
