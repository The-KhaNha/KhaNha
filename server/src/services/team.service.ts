import { createHash, randomBytes } from 'node:crypto';
import { PostgrestError } from '@supabase/supabase-js';
import { INVITE_EXPIRY_DAYS, type CreateInviteInput } from '../schemas/team.schema';
import type { RequestContext } from '../types/auth';
import type { InviteDto, MemberDto } from '../types/api';
import { forbidden, membershipExists, notFound } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { toInviteDto, toMemberDto } from '../utils/serializers';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITE_SELECT = 'id, role, email, expires_at, created_at';

/** Only the hash is stored: a leaked table cannot be turned back into a link that works. */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The headers audit_row_change reads who and which request from, on every write to an audited table. */
const audited = <T extends { setHeader(name: string, value: string): T }>(
  query: T,
  ctx: RequestContext,
): T =>
  query.setHeader('x-actor', JSON.stringify(ctx.actor)).setHeader('x-request-id', ctx.requestId);

/** The store's members (name, email, role) and its open invites. Not cached: it is read rarely and changes often. */
export async function listTeam(
  storeId: string,
): Promise<{ members: MemberDto[]; invites: InviteDto[] }> {
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabaseAdmin
      .from('store_memberships')
      .select(
        'id, role, created_at, user:profiles!store_memberships_user_id_fkey (id, name, email)',
      )
      .eq('store_id', storeId)
      .order('created_at')
      .throwOnError(),
    supabaseAdmin
      .from('store_invites')
      .select(INVITE_SELECT)
      .eq('store_id', storeId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at')
      .throwOnError(),
  ]);
  return { members: members.map(toMemberDto), invites: invites.map(toInviteDto) };
}

/**
 * A new invite and its token, which is returned here once and never again. `canManageManagers` is the caller's
 * standing for `team.manageManagers`, which inviting a MANAGER needs.
 */
export async function createInvite(
  { id: storeId, brandId }: { id: string; brandId: string },
  input: CreateInviteInput,
  canManageManagers: boolean,
  ctx: RequestContext,
  now = new Date(),
): Promise<{ invite: InviteDto; token: string }> {
  if (input.role === 'MANAGER' && !canManageManagers)
    throw forbidden('Only the owner can invite a manager.');

  const { data: member } = await supabaseAdmin
    .from('store_memberships')
    .select('id, user:profiles!store_memberships_user_id_fkey!inner (email)')
    .eq('store_id', storeId)
    .eq('user.email', input.email)
    .maybeSingle()
    .throwOnError();
  if (member) throw membershipExists();
  // The brand's owner is OWNER of every store with no membership row: an invite would only add a lesser one.
  const { data: owned } = await supabaseAdmin
    .from('brands')
    .select('id, owner:profiles!brands_owner_id_fkey!inner (email)')
    .eq('id', brandId)
    .eq('owner.email', input.email)
    .maybeSingle()
    .throwOnError();
  if (owned) throw membershipExists();

  // An expired invite still holds the open-invite unique index: close it so the email can be invited again.
  await audited(
    supabaseAdmin
      .from('store_invites')
      .update({ revoked_at: now.toISOString() })
      .eq('store_id', storeId)
      .eq('email', input.email)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .lte('expires_at', now.toISOString()),
    ctx,
  ).throwOnError();

  const token = randomBytes(32).toString('base64url');
  try {
    const { data } = await audited(
      supabaseAdmin
        .from('store_invites')
        .insert({
          store_id: storeId,
          role: input.role,
          email: input.email,
          token_hash: hashToken(token),
          expires_at: new Date(now.getTime() + INVITE_EXPIRY_DAYS * DAY_MS).toISOString(),
          created_by: ctx.actor.id,
        })
        .select(INVITE_SELECT)
        .single(),
      ctx,
    ).throwOnError();
    return { invite: toInviteDto(data), token };
  } catch (err) {
    // store_invites_open_email_key: an open invite for this email already.
    if (err instanceof PostgrestError && err.code === '23505') throw membershipExists();
    throw err;
  }
}

/** Closes an open invite of this store. Revoking one twice is a no-op; another store's invite is 404. */
export async function revokeInvite(
  storeId: string,
  inviteId: string,
  canManageManagers: boolean,
  ctx: RequestContext,
): Promise<void> {
  if (!isUuid(inviteId)) throw notFound('Invite not found.');
  const { data: invite } = await supabaseAdmin
    .from('store_invites')
    .select('role, accepted_at, revoked_at')
    .eq('id', inviteId)
    .eq('store_id', storeId)
    .maybeSingle()
    .throwOnError();
  if (!invite || invite.accepted_at) throw notFound('Invite not found.');
  if (invite.role === 'MANAGER' && !canManageManagers)
    throw forbidden('Only the owner can revoke a manager invite.');
  if (invite.revoked_at) return;
  await audited(
    supabaseAdmin
      .from('store_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inviteId)
      // Accepted since the read above: the CHECK forbids revoking it, and there is nothing left to revoke.
      .is('accepted_at', null)
      .is('revoked_at', null),
    ctx,
  ).throwOnError();
}

/**
 * Removes a membership of this store. A manager may be removed only by the owner or an admin, or by themselves. The
 * brand's owner is no membership, so cannot be removed here. requireAuth reads memberships on every request, so the
 * removal takes effect on the next one.
 */
export async function removeMember(
  storeId: string,
  membershipId: string,
  callerId: string,
  canManageManagers: boolean,
  ctx: RequestContext,
): Promise<void> {
  if (!isUuid(membershipId)) throw notFound('Member not found.');
  const { data: member } = await supabaseAdmin
    .from('store_memberships')
    .select('role, user_id')
    .eq('id', membershipId)
    .eq('store_id', storeId)
    .maybeSingle()
    .throwOnError();
  if (!member) throw notFound('Member not found.');
  if (member.role === 'MANAGER' && member.user_id !== callerId && !canManageManagers)
    throw forbidden('Only the owner can remove a manager.');
  await audited(
    supabaseAdmin.from('store_memberships').delete().eq('id', membershipId),
    ctx,
  ).throwOnError();
}

const acceptRpc = (token: string, userId: string, email: string, ctx: RequestContext) =>
  supabaseAdmin.rpc('accept_store_invite', {
    p_token_hash: hashToken(token),
    p_user_id: userId,
    p_email: email,
    p_actor: ctx.actor,
    p_request_id: ctx.requestId,
  });

/**
 * Accepts an invite for the signed-in account: its token, and the account's email must be the one invited. Every
 * refusal is the same 404 (accept_store_invite). Returns the membership and its store, so the client can go there.
 */
export async function acceptInvite(
  token: string,
  userId: string,
  ctx: RequestContext,
): Promise<{
  id: string;
  role: MemberDto['role'];
  store: { id: string; slug: string; name: string };
}> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single()
    .throwOnError();
  let membership: Awaited<ReturnType<typeof acceptRpc>>['data'];
  try {
    ({ data: membership } = await acceptRpc(token, userId, profile.email, ctx).throwOnError());
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND')) throw notFound('That invite is not valid any more.');
    throw err;
  }
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, slug, name')
    .eq('id', membership.store_id)
    .single()
    .throwOnError();
  return { id: membership.id, role: membership.role, store };
}
