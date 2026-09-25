import type { AuthError } from '@supabase/supabase-js';
import type { RegisterInput } from '../schemas/auth.schema';
import type { Tables } from '../types/database';
import { AppError, notFound, validationError } from '../utils/errors';
import { supabaseAdmin } from '../utils/supabase';

/**
 * Creates a Supabase Auth user; the on_auth_user_created trigger turns it into a CUSTOMER profile.
 * Signing in happens in the browser with supabase-js, straight after this returns.
 *
 * Registration goes through the API (not supabase.auth.signUp in the browser) so the same zod rules as before
 * apply, and so the account is usable at once: it is created already confirmed, and no email is sent.
 */
export async function register(input: RegisterInput): Promise<Tables<'profiles'>> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name, phone: input.phone ?? null },
  });
  if (error) throw describeAuthError(error);
  return getProfile(data.user.id);
}

export async function getProfile(id: string): Promise<Tables<'profiles'>> {
  const { data: profile } = await supabaseAdmin.from('profiles').select().eq('id', id).maybeSingle().throwOnError();
  if (!profile) throw notFound('Account not found.');
  return profile;
}

function describeAuthError(error: AuthError): Error {
  switch (error.code) {
    case 'email_exists':
    case 'user_already_exists':
      return new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Try signing in.');
    case 'email_address_invalid':
      return validationError('Please enter a valid email address.');
    case 'weak_password':
      return validationError(error.message);
    default:
      return error;
  }
}
