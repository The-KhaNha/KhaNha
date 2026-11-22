import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { Input } from '../../components/Input';
import { Skeleton } from '../../components/Skeleton';
import { getSupabase } from '../../lib/supabase';

/** How old an unfinished enrolment must be before a new visit drops it (presentation constant). */
const HALF_DONE_STALE_MS = 10 * 60 * 1000;

/** Enrolling: the factor to verify, with what an authenticator app needs to add it. */
type Step =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string }
  | { kind: 'code'; factorId: string };

/**
 * The admin's second factor (P7.4a PR 04): admin routes answer MFA_REQUIRED until this sign-in has a TOTP code. With
 * no factor yet, it enrols one (a QR code and its secret for an authenticator app); otherwise it asks for the code.
 * A verified code upgrades the session (supabase-js keeps it), so the next request carries an aal2 token.
 */
/** A wrong code says so; a dropped connection or Supabase's rate limit must not look like one. */
function verifyMessage(error: { status?: number; code?: string; name?: string }): string {
  if (error.status === 429) return 'Too many tries. Wait a minute, then enter the newest code.';
  if (error.name === 'AuthRetryableFetchError' || error.status === undefined || error.status >= 500)
    return "We couldn't check the code. Check your connection and try again.";
  return "That code didn't work. Check the app and try the new one.";
}

export function SecondFactor({ onVerified }: { onVerified: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // One setup per attempt: StrictMode's second effect run must not enrol a second factor beside the first.
  const startedFor = useRef(-1);

  useEffect(() => {
    if (startedFor.current === attempt) return;
    startedFor.current = attempt;
    let live = true;
    (async () => {
      const mfa = (await getSupabase()).auth.mfa;
      const { data, error: listError } = await mfa.listFactors();
      if (listError) throw listError;
      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) return { kind: 'code', factorId: verified.id } as const;
      // An enrolment left half done (the page closed before its first code) is dropped, but only an old one: a
      // fresh one may be the QR code another tab is showing right now.
      const stale = Date.now() - HALF_DONE_STALE_MS;
      for (const f of data.all.filter(
        (f) =>
          f.factor_type === 'totp' && f.status !== 'verified' && Date.parse(f.created_at) < stale,
      ))
        await mfa.unenroll({ factorId: f.id });
      const { data: enrolled, error: enrollError } = await mfa.enroll({ factorType: 'totp' });
      if (enrollError) throw enrollError;
      return {
        kind: 'enroll',
        factorId: enrolled.id,
        qr: enrolled.totp.qr_code,
        secret: enrolled.totp.secret,
      } as const;
    })().then(
      (next) => live && setStep(next),
      () => live && setStep({ kind: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (step.kind !== 'enroll' && step.kind !== 'code') return;
    // Apps show and copy the code as "123 456": spaces are not part of it.
    const digits = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(digits)) return setError('Enter the 6-digit code from the app.');
    setBusy(true);
    setError(undefined);
    const { error: verifyError } = await (
      await getSupabase()
    ).auth.mfa.challengeAndVerify({ factorId: step.factorId, code: digits });
    setBusy(false);
    if (verifyError) return setError(verifyMessage(verifyError));
    onVerified();
  }

  if (step.kind === 'loading')
    return (
      <Card as="section" padding="lg" aria-busy aria-label="Checking your sign-in">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-4 h-11 w-full rounded-control" />
      </Card>
    );
  if (step.kind === 'failed')
    return (
      <ErrorState
        compact
        title="Couldn't start the security check"
        message="Check your connection and try again."
        onRetry={() => {
          setStep({ kind: 'loading' });
          setAttempt((n) => n + 1);
        }}
      />
    );

  return (
    <Card as="section" padding="lg" aria-label="Security check">
      <h2 className="text-xl font-extrabold">
        {step.kind === 'enroll' ? 'Set up your authenticator app' : 'Enter your code'}
      </h2>
      {step.kind === 'enroll' ? (
        <div className="mt-2 space-y-3 text-sm text-muted">
          <p>
            Admin tools need a second step. Scan this code with an authenticator app (Google
            Authenticator, 1Password, Authy), then enter the 6-digit code it shows.
          </p>
          <img
            src={step.qr}
            alt="QR code to add this account to an authenticator app"
            width={176}
            height={176}
            className="mx-auto rounded-card bg-surface p-2"
          />
          <p className="wrap-anywhere">
            Can't scan? Enter this key instead:{' '}
            <span className="font-mono font-semibold text-ink">{step.secret}</span>
          </p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Open your authenticator app and enter the 6-digit code for this account.
        </p>
      )}
      <form onSubmit={verify} noValidate className="mt-4 space-y-4">
        <Input
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={error}
        />
        <Button type="submit" fullWidth loading={busy}>
          Continue
        </Button>
      </form>
    </Card>
  );
}
