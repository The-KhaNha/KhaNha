// touch_session and purge_session_activity through their RPCs, with the clock passed as p_now (ADR-011 follow-up).
// touch_session accepts only a session live in auth.sessions, so each case signs in for one of its own.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, signInAgain, type TestUser } from '../setup/helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed clock, so "days later" never depends on when the suite runs.
const T0 = new Date('2020-01-01T12:00:00Z').getTime();
const at = (days: number): string => new Date(T0 + days * DAY_MS).toISOString();
let user: TestUser;

beforeAll(async () => {
  user = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(user); // cascades to its auth sessions and session_activity rows
});

async function touch(sessionId: string, days: number): Promise<boolean> {
  const { data } = await supabaseAdmin
    .rpc('touch_session', {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_idle: '7 days',
      p_now: at(days),
    })
    .throwOnError();
  return data;
}

/** A new, live auth session of `user`. */
async function liveSession(): Promise<string> {
  return (await signInAgain(user)).sessionId;
}

/** A session_activity row written directly, for a session id auth.sessions may not hold. */
async function seen(sessionId: string, days: number): Promise<void> {
  await supabaseAdmin
    .from('session_activity')
    .upsert({ session_id: sessionId, user_id: user.id, last_seen_at: at(days) })
    .throwOnError();
}

async function lastSeen(sessionId: string): Promise<string | undefined> {
  const { data } = await supabaseAdmin
    .from('session_activity')
    .select('last_seen_at')
    .eq('session_id', sessionId)
    .maybeSingle()
    .throwOnError();
  return data ? new Date(data.last_seen_at).toISOString() : undefined;
}

describe('touch_session', () => {
  it('accepts a live session never seen, and starts its clock', async () => {
    const session = await liveSession();
    expect(await touch(session, 0)).toBe(true);
    expect(await lastSeen(session)).toBe(at(0));
  });

  it('accepts a session used within the idle window, and restarts its clock', async () => {
    const session = await liveSession();
    await touch(session, 0);
    expect(await touch(session, 6.9)).toBe(true);
    expect(await lastSeen(session)).toBe(at(6.9));
    // The week counts from the last use, not from the sign-in.
    expect(await touch(session, 13)).toBe(true);
  });

  it('refuses a session idle longer than the window, and leaves it idle', async () => {
    const session = await liveSession();
    await touch(session, 0);
    expect(await touch(session, 7.1)).toBe(false);
    expect(await lastSeen(session)).toBe(at(0));
    // Refused for good: a later request on the same session is still idle.
    expect(await touch(session, 8)).toBe(false);
  });

  it('never moves the clock backwards', async () => {
    const session = await liveSession();
    await touch(session, 2);
    expect(await touch(session, 1)).toBe(true);
    expect(await lastSeen(session)).toBe(at(2));
  });

  it('refuses a session gone from auth.sessions, even one used a moment ago, and records nothing', async () => {
    // Signed out or revoked: its access token is still valid for up to an hour.
    const recent = randomUUID();
    await seen(recent, 0);
    expect(await touch(recent, 0.01)).toBe(false);
    expect(await lastSeen(recent)).toBe(at(0));
    // And once the purge has dropped its row, it is not "never seen".
    const unknown = randomUUID();
    expect(await touch(unknown, 0)).toBe(false);
    expect(await lastSeen(unknown)).toBeUndefined();
  });
});

describe('purge_session_activity', () => {
  it('deletes the rows whose session Supabase Auth no longer holds', async () => {
    const ended = randomUUID(); // no auth.sessions row: signed out, revoked or never real
    await seen(ended, 0);
    const { data: deleted } = await supabaseAdmin.rpc('purge_session_activity').throwOnError();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await lastSeen(ended)).toBeUndefined();
  });

  it('keeps the row of a live session however old its last use', async () => {
    // Purging it would make the session "never seen" again, and its refresh token usable after any idle time.
    const live = await liveSession();
    await touch(live, 0); // 2020: older than any age a purge could keep
    await supabaseAdmin.rpc('purge_session_activity').throwOnError();
    expect(await lastSeen(live)).toBe(at(0));
  });
});
