import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ getSupabase: async () => ({ auth: { mfa } }) }));

const { SecondFactor } = await import('./SecondFactor');

const verifiedFactor = { id: 'f1', factor_type: 'totp', status: 'verified' };

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => vi.useRealTimers());

const typeCode = (code: string) => {
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};

describe('SecondFactor', () => {
  it('with a factor already, asks for the code and reports a verified one', async () => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [verifiedFactor], totp: [verifiedFactor] },
      error: null,
    });
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    const onVerified = vi.fn();
    render(<SecondFactor onVerified={onVerified} />);
    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
    typeCode('123456');
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' });
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it('refuses a code that is not six digits without asking Supabase, and shows a wrong one', async () => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [verifiedFactor], totp: [verifiedFactor] },
      error: null,
    });
    mfa.challengeAndVerify.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Invalid TOTP code'), { status: 422, name: 'AuthApiError' }),
    });
    const onVerified = vi.fn();
    render(<SecondFactor onVerified={onVerified} />);
    await screen.findByRole('heading', { name: 'Enter your code' });
    typeCode('12');
    expect(await screen.findByText('Enter the 6-digit code from the app.')).toBeInTheDocument();
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
    typeCode('000000');
    expect(await screen.findByText(/That code didn't work/)).toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('with no factor, drops an old half-done one (not a fresh one) and enrols: the QR code and its key', async () => {
    const stale = {
      id: 'old',
      factor_type: 'totp',
      status: 'unverified',
      created_at: '2000-01-01T00:00:00Z',
    };
    const fresh = {
      id: 'other-tab',
      factor_type: 'totp',
      status: 'unverified',
      created_at: new Date().toISOString(),
    };
    mfa.listFactors.mockResolvedValue({ data: { all: [stale, fresh], totp: [] }, error: null });
    mfa.unenroll.mockResolvedValue({ data: {}, error: null });
    mfa.enroll.mockResolvedValue({
      data: {
        id: 'new',
        totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCDEF234567' },
      },
      error: null,
    });
    render(<SecondFactor onVerified={vi.fn()} />);
    expect(
      await screen.findByRole('heading', { name: 'Set up your authenticator app' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /QR code/ })).toHaveAttribute(
      'src',
      'data:image/svg+xml;utf-8,<svg/>',
    );
    expect(screen.getByText('ABCDEF234567')).toBeInTheDocument();
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' });
    expect(mfa.unenroll).not.toHaveBeenCalledWith({ factorId: 'other-tab' });
    expect(mfa.enroll).toHaveBeenCalledWith({
      factorType: 'totp',
      friendlyName: expect.stringMatching(/^admin-totp-\d+$/),
    });
  });

  it('accepts a code pasted with a space, and tells a dropped connection from a wrong code', async () => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [verifiedFactor], totp: [verifiedFactor] },
      error: null,
    });
    mfa.challengeAndVerify.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' }),
    });
    render(<SecondFactor onVerified={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Enter your code' });
    typeCode('482 913');
    expect(await screen.findByText(/couldn't check the code/)).toBeInTheDocument();
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '482913' });
  });

  it('a failure to start shows a retry that tries again', async () => {
    mfa.listFactors
      .mockResolvedValueOnce({ data: null, error: new Error('offline') })
      .mockResolvedValue({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null });
    render(<SecondFactor onVerified={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
  });

  it('under StrictMode the replayed effect still receives the setup result, with one enrolment', async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
    mfa.enroll.mockResolvedValue({
      data: { id: 'new', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'KEY' } },
      error: null,
    });
    render(
      <StrictMode>
        <SecondFactor onVerified={vi.fn()} />
      </StrictMode>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Set up your authenticator app' }),
    ).toBeInTheDocument();
    expect(mfa.enroll).toHaveBeenCalledTimes(1);
  });

  it('a setup request that never answers times out into the retry state', async () => {
    vi.useFakeTimers();
    mfa.listFactors.mockReturnValue(new Promise(() => {}));
    render(<SecondFactor onVerified={vi.fn()} />);
    await act(() => vi.advanceTimersByTimeAsync(30 * 1000));
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });

  it('a verify request that never answers times out, frees the button and says so', async () => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [verifiedFactor], totp: [verifiedFactor] },
      error: null,
    });
    mfa.challengeAndVerify.mockReturnValue(new Promise(() => {}));
    render(<SecondFactor onVerified={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Enter your code' });
    vi.useFakeTimers();
    typeCode('123456');
    await act(() => vi.advanceTimersByTimeAsync(30 * 1000));
    expect(screen.getByText(/couldn't check the code/)).toBeInTheDocument();
  });
});
