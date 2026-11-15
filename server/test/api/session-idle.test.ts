// requireAuth's idle sign-out end to end: real sign-ins, one session's activity row back-dated past the window.
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/utils/env';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createTestUser,
  deleteTestUser,
  signInAgain,
  throwawayClient,
  type TestUser,
} from '../setup/helpers';

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser();
});
afterAll(async () => {
  await deleteTestUser(user);
});

describe('idle session', () => {
  it('is refused with 401, revoked, and leaves the same user’s other session working', async () => {
    const idle = await signInAgain(user);
    const other = await signInAgain(user);
    // Back-dated before its first request, so the API's per-process touch throttle cannot skip the check.
    const old = new Date(Date.now() - (env.SESSION_IDLE_DAYS + 1) * 24 * 60 * 60 * 1000);
    await supabaseAdmin
      .from('session_activity')
      .upsert({ session_id: idle.sessionId, user_id: user.id, last_seen_at: old.toISOString() })
      .throwOnError();

    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${idle.token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: expect.any(String) },
    });

    // Revoked: the refresh token no longer mints a new access token.
    const refreshed = await throwawayClient().auth.refreshSession({ refresh_token: idle.refresh });
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();

    const ok = await api().get('/api/auth/me').set('Authorization', `Bearer ${other.token}`);
    expect(ok.status).toBe(200);
    const stillValid = await throwawayClient().auth.refreshSession({
      refresh_token: other.refresh,
    });
    expect(stillValid.error).toBeNull();
  });

  it('refuses a signed-out session whose access token is still valid', async () => {
    // The refresh token dies at sign-out; the access token is checked locally and would pass for up to an hour.
    const ended = await signInAgain(user);
    const { error } = await supabaseAdmin.auth.admin.signOut(ended.token, 'local');
    expect(error).toBeNull();

    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${ended.token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    // The shape enforceSessionIdle reads as "already revoked" (no warn): GoTrue's session_not_found, as auth-js maps it.
    const again = await supabaseAdmin.auth.admin.signOut(ended.token, 'local');
    expect(isAuthSessionMissingError(again.error)).toBe(true);
  });
});
