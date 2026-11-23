import { useState, type FormEvent } from 'react';
import { Store } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Input } from '../../components/Input';
import { InviteLink } from '../../components/InviteLink';
import { Skeleton } from '../../components/Skeleton';
import { TimeText } from '../../components/TimeText';
import { ApiError } from '../../services/api';
import { createBrand, createOwnerInvite, revokeOwnerInvite } from '../../services/admin';
import type { AdminBrand } from '../../types/api';
import { validateEmail } from '../auth/validation';
import { useNow } from '../../lib/useNow';
import { useAdminBrands } from './useAdminBrands';

type Link = { email: string; url: string };
type Pending = { brandId: string; inviteId: string; email: string } | null;

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong.');
// The owner link is built here, the same way ManageTeam builds the team link.
const ownerLink = (token: string) => `${window.location.origin}/join/owner#${token}`;

/** The Restaurants section of `/admin`: make a restaurant, share its owner's invite link, see who owns what. */
export function Restaurants() {
  const { data, isLoading, error, reload } = useAdminBrands();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [busy, setBusy] = useState(false);
  // The one-time token lives in this component's state only: never a store or browser storage.
  const [link, setLink] = useState<Link | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  // One invite at a time, and none while a one-time link is still on screen (rows and the create form alike): a
  // second link would replace it before the admin copied it.
  const [sending, setSending] = useState(false);
  const linkLocked = sending || link !== null;
  const [actionError, setActionError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (linkLocked) return;
    const next: { name?: string; email?: string } = {};
    if (name.trim().length < 2) next.name = 'Enter the restaurant name.';
    const problem = validateEmail(email);
    if (problem) next.email = problem;
    setErrors(next);
    if (next.name || next.email) return;
    setBusy(true);
    setActionError(null);
    let brandId: string;
    try {
      brandId = (await createBrand({ name: name.trim() })).id;
    } catch (err) {
      // The slug is made from the name, so a slug or name problem both land on the name field.
      setErrors({ name: message(err) });
      setBusy(false);
      return;
    }
    try {
      const { token } = await createOwnerInvite(brandId, email.trim());
      setLink({ email: email.trim(), url: ownerLink(token) });
      setEmail('');
    } catch (err) {
      // The brand exists: it is in the list with "Invite owner", so a retry never makes a second one.
      setActionError(
        `The restaurant was created, but its invite was not: ${message(err)} Use "Invite owner" below.`,
      );
    }
    setName('');
    reload();
    setBusy(false);
  }

  async function revoke() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      await revokeOwnerInvite(pending.brandId, pending.inviteId);
      reload();
    } catch (err) {
      setActionError(message(err));
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  return (
    <section aria-label="Restaurants" className="space-y-4">
      <div>
        <h2 className="text-xl font-extrabold">Restaurants</h2>
        <p className="mt-1 text-sm text-muted">
          Create a restaurant, then share the link with its owner. Nothing is emailed.
        </p>
      </div>

      <Card as="section" padding="lg">
        <h3 className="text-lg font-extrabold">New restaurant</h3>
        <form onSubmit={create} noValidate className="mt-3 space-y-4">
          <Input
            label="Restaurant name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />
          <Input
            label="Owner email"
            type="email"
            autoComplete="off"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <Button type="submit" fullWidth loading={busy && !pending} disabled={linkLocked}>
            Create and get link
          </Button>
        </form>
        {link && (
          <InviteLink
            key={link.url}
            email={link.email}
            url={link.url}
            onDone={() => setLink(null)}
          />
        )}
      </Card>

      {actionError && (
        <p role="alert" className="wrap-anywhere text-sm font-semibold text-brand-700">
          {actionError}
        </p>
      )}

      {isLoading ? (
        <Card as="section" padding="lg" aria-busy aria-label="Loading restaurants">
          <Skeleton className="h-11 w-full rounded-control" />
        </Card>
      ) : error?.code === 'MFA_REQUIRED' ? null : error || !data ? ( // The page shows the second-factor step instead (pages/Admin.tsx).
        <ErrorState
          compact
          unreachable={error?.isUnreachable}
          title="Restaurants didn't load"
          message={error?.message}
          onRetry={reload}
        />
      ) : data.length === 0 ? (
        <EmptyState
          icon={Store}
          tone="neutral"
          title="No restaurants yet"
          description="Create the first one above."
        />
      ) : (
        <ul className="space-y-3">
          {data.map((brand) => (
            <BrandRow
              key={brand.id}
              brand={brand}
              locked={busy || linkLocked}
              onSending={setSending}
              onLink={(next) => {
                setLink(next);
                setActionError(null);
                reload();
              }}
              onRevoke={(inviteId, inviteEmail) =>
                setPending({ brandId: brand.id, inviteId, email: inviteEmail })
              }
            />
          ))}
        </ul>
      )}

      {pending && (
        <ConfirmSheet
          title="Revoke this invite?"
          text={`The link for ${pending.email} stops working.`}
          confirmLabel="Revoke"
          busy={busy}
          onConfirm={revoke}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

function BrandRow({
  brand,
  locked,
  onSending,
  onLink,
  onRevoke,
}: {
  brand: AdminBrand;
  locked: boolean;
  onSending: (sending: boolean) => void;
  onLink: (link: Link) => void;
  onRevoke: (inviteId: string, email: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invite = brand.invite;
  // A minute is fine-grained enough to flip "expires" to "expired" on a list an admin leaves open.
  const now = useNow(60_000);

  async function sendInvite(to: string) {
    setBusy(true);
    onSending(true);
    setError(null);
    try {
      const { token } = await createOwnerInvite(brand.id, to);
      onLink({ email: to, url: ownerLink(token) });
      setOpen(false);
      setEmail('');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      onSending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateEmail(email);
    if (problem) return setError(problem);
    if (locked) return;
    void sendInvite(email.trim());
  }

  return (
    <li>
      <Card padding="lg">
        <p className="wrap-anywhere font-semibold">{brand.name}</p>
        <p className="text-caption text-muted">
          {brand.branchCount} {brand.branchCount === 1 ? 'branch' : 'branches'}
        </p>
        {brand.owner ? (
          <p className="wrap-anywhere mt-2 text-sm">
            Owner: {brand.owner.name} ({brand.owner.email})
          </p>
        ) : invite ? (
          <div className="mt-2 space-y-2">
            <p className="wrap-anywhere text-sm">
              Invite open for {invite.email},{' '}
              {Date.parse(invite.expiresAt) <= now.getTime() ? 'expired' : 'expires'}{' '}
              <TimeText iso={invite.expiresAt} withDay />
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                loading={busy}
                disabled={locked}
                onClick={() => void sendInvite(invite.email)}
              >
                New link
              </Button>
              <Button
                variant="ghost-danger"
                aria-label={`Revoke invite for ${invite.email}`}
                onClick={() => onRevoke(invite.id, invite.email)}
              >
                Revoke
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-muted">No owner</p>
            {open ? (
              <form onSubmit={submit} noValidate className="space-y-3">
                <Input
                  label="Owner email"
                  type="email"
                  autoComplete="off"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={error ?? undefined}
                />
                <Button type="submit" loading={busy} disabled={locked}>
                  Create link
                </Button>
              </form>
            ) : (
              <Button variant="secondary" disabled={locked} onClick={() => setOpen(true)}>
                Invite owner
              </Button>
            )}
          </div>
        )}
        {error && !open && (
          <p role="alert" className="mt-2 text-sm font-semibold text-brand-700">
            {error}
          </p>
        )}
      </Card>
    </li>
  );
}
