import { isAuthRetryableFetchError, type AuthError, type Session } from '@supabase/supabase-js';
import type { User } from '../types/api';
import { supabase } from '../lib/supabase';
import { ApiError, request } from './api';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

/** Signs in with Supabase Auth. Errors are ApiErrors with a message that is safe to show, like every API error. */
export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw describeAuthError(error);
  return data.session;
}

/** Ends the session on this device only (other devices stay signed in). */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' });
}

/** The API creates the account (already confirmed); the caller signs in afterwards. */
export function register(input: RegisterInput): Promise<{ user: User }> {
  return request<{ user: User }>('/auth/register', { method: 'POST', body: input, auth: false });
}

export function fetchMe(): Promise<{ user: User }> {
  return request<{ user: User }>('/auth/me');
}

function describeAuthError(error: AuthError): ApiError {
  if (isAuthRetryableFetchError(error)) {
    return new ApiError(0, 'UNREACHABLE', "We couldn't reach the server. Check your connection and try again.");
  }
  switch (error.code) {
    case 'invalid_credentials':
      // Same message for unknown email and wrong password so accounts cannot be enumerated.
      return new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    case 'over_request_rate_limit':
      return new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a minute and try again.');
    default:
      return new ApiError(error.status ?? 500, 'INTERNAL', 'Something went wrong. Please try again.');
  }
}
