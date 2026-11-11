import { randomUUID } from 'node:crypto';
import { AuthApiError, AuthSessionMissingError } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentUser,
  enforceSessionIdle,
  requireAdmin,
  requireStaff,
  SESSION_TOUCH_EVERY_MS,
} from '../../src/middleware/auth';
import type { AuthUser } from '../../src/types/auth';
import { supabaseAdmin } from '../../src/utils/supabase';

function reqWith(user?: AuthUser): { user?: AuthUser } {
  return { user };
}

const none = { memberships: [], ownedBrandIds: [] };
const staff: AuthUser = { id: 'u-staff', role: 'STAFF', ...none };
const admin: AuthUser = { id: 'u-admin', role: 'ADMIN', ...none };
const customer: AuthUser = { id: 'u-customer', role: 'CUSTOMER', ...none };

describe('currentUser', () => {
  it('returns req.user when requireAuth has set it', () => {
    expect(currentUser(reqWith(staff))).toBe(staff);
  });

  it('throws 401 UNAUTHORIZED when requireAuth never ran', () => {
    expect(() => currentUser(reqWith(undefined))).toThrowError(
      expect.objectContaining({ status: 401, code: 'UNAUTHORIZED' }),
    );
  });
});

describe('requireAdmin', () => {
  it('calls next() for an ADMIN', () => {
    const next = vi.fn();
    requireAdmin(reqWith(admin) as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('throws 403 FORBIDDEN for staff (an admin has no staff powers, and staff has no admin powers)', () => {
    const next = vi.fn();
    expect(() => requireAdmin(reqWith(staff) as never, {} as never, next)).toThrowError(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 403 FORBIDDEN for a customer', () => {
    const next = vi.fn();
    expect(() => requireAdmin(reqWith(customer) as never, {} as never, next)).toThrowError(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireStaff', () => {
  it('calls next() for STAFF', () => {
    const next = vi.fn();
    requireStaff(reqWith(staff) as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws 403 FORBIDDEN for an ADMIN (no staff powers)', () => {
    const next = vi.fn();
    expect(() => requireStaff(reqWith(admin) as never, {} as never, next)).toThrowError(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 403 FORBIDDEN for a customer', () => {
    const next = vi.fn();
    expect(() => requireStaff(reqWith(customer) as never, {} as never, next)).toThrowError(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('enforceSessionIdle (the RPC and the sign-out stubbed)', () => {
  const T = 1_800_000_000_000;
  const log = () => ({ error: vi.fn(), warn: vi.fn() });
  function stubTouch(answer: { data: boolean | null; error: { message: string } | null }) {
    return vi.spyOn(supabaseAdmin, 'rpc').mockResolvedValue(answer as never);
  }
  function stubSignOut() {
    return vi
      .spyOn(supabaseAdmin.auth.admin, 'signOut')
      .mockResolvedValue({ data: null, error: null });
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares one check between concurrent first requests of a session', async () => {
    const rpc = stubTouch({ data: true, error: null });
    const session = randomUUID();
    const l = log() as unknown as Logger;
    await Promise.all(
      Array.from({ length: 8 }, () => enforceSessionIdle(session, 'u1', 'tok', l, T)),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('refuses every concurrent request of an idle session, with one check and one revoke', async () => {
    const rpc = stubTouch({ data: false, error: null });
    const signOut = stubSignOut();
    const session = randomUUID();
    const l = log() as unknown as Logger;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => enforceSessionIdle(session, 'u1', 'tok', l, T)),
    );
    expect(results.every((r) => r.status === 'rejected' && r.reason.status === 401)).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('records a session once per window per process, then again after it', async () => {
    const rpc = stubTouch({ data: true, error: null });
    const session = randomUUID();
    const l = log();
    await enforceSessionIdle(session, 'u1', 'tok', l as unknown as Logger, T);
    await enforceSessionIdle(
      session,
      'u1',
      'tok',
      l as unknown as Logger,
      T + SESSION_TOUCH_EVERY_MS - 1,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('touch_session', {
      p_session_id: session,
      p_user_id: 'u1',
      p_idle: '7 days',
    });
    await enforceSessionIdle(
      session,
      'u1',
      'tok',
      l as unknown as Logger,
      T + SESSION_TOUCH_EVERY_MS,
    );
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('refuses an idle or ended session with 401, revokes it once, and answers its replays from memory', async () => {
    const rpc = stubTouch({ data: false, error: null });
    const signOut = stubSignOut();
    const session = randomUUID();
    const l = log();
    await expect(
      enforceSessionIdle(session, 'u1', 'tok', l as unknown as Logger, T),
    ).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Your session has expired. Please sign in again.',
    });
    expect(signOut).toHaveBeenCalledWith('tok', 'local');
    // A replayed token within the window: refused at once, with no RPC and no second sign-out.
    await expect(
      enforceSessionIdle(session, 'u1', 'tok', l as unknown as Logger, T + 1),
    ).rejects.toMatchObject({ status: 401 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('still refuses when the revoke fails, and says so', async () => {
    stubTouch({ data: false, error: null });
    vi.spyOn(supabaseAdmin.auth.admin, 'signOut').mockResolvedValue({
      data: null,
      error: new AuthApiError('auth down', 500, 'unexpected_failure'),
    });
    const l = log();
    await expect(
      enforceSessionIdle(randomUUID(), 'u1', 'tok', l as unknown as Logger, T),
    ).rejects.toMatchObject({ status: 401 });
    expect(l.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      'Idle session not revoked',
    );
  });

  it('does not warn when the session is already gone (session_not_found)', async () => {
    stubTouch({ data: false, error: null });
    // What auth-js returns for GoTrue's session_not_found.
    vi.spyOn(supabaseAdmin.auth.admin, 'signOut').mockResolvedValue({
      data: null,
      error: new AuthSessionMissingError(),
    });
    const l = log();
    await expect(
      enforceSessionIdle(randomUUID(), 'u1', 'tok', l as unknown as Logger, T),
    ).rejects.toMatchObject({ status: 401 });
    expect(l.warn).not.toHaveBeenCalled();
  });

  it('fails open when the check itself fails: the request goes on, logged once per window', async () => {
    const rpc = stubTouch({ data: null, error: { message: 'Could not find the function' } });
    const signOut = stubSignOut();
    const session = randomUUID();
    const l = log();
    await enforceSessionIdle(session, 'u1', 'tok', l as unknown as Logger, T);
    await enforceSessionIdle(session, 'u1', 'tok', l as unknown as Logger, T + 1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(l.error).toHaveBeenCalledTimes(1);
    expect(l.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      'Session idle check failed',
    );
    expect(signOut).not.toHaveBeenCalled();
  });

  it('logs a failing check once per window across all sessions, with the count it skipped', async () => {
    stubTouch({ data: null, error: { message: 'Could not find the function' } });
    // Far from the other tests' clock, so the window they opened has long passed.
    const start = T + 100 * SESSION_TOUCH_EVERY_MS;
    const l = log();
    for (let i = 0; i < 50; i++) {
      await enforceSessionIdle(randomUUID(), `u${i}`, 'tok', l as unknown as Logger, start + i);
    }
    expect(l.error).toHaveBeenCalledTimes(1);
    await enforceSessionIdle(
      randomUUID(),
      'u50',
      'tok',
      l as unknown as Logger,
      start + SESSION_TOUCH_EVERY_MS,
    );
    expect(l.error).toHaveBeenCalledTimes(2);
    expect(l.error).toHaveBeenLastCalledWith(
      expect.objectContaining({ suppressed: 49 }),
      'Session idle check failed',
    );
  });

  it('skips a token without a well-formed session_id', async () => {
    const rpc = stubTouch({ data: false, error: null });
    for (const sessionId of [undefined, 42, 'not-a-uuid']) {
      await enforceSessionIdle(sessionId, 'u1', 'tok', log() as unknown as Logger, T);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
