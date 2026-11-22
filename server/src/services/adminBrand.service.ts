import { randomBytes } from 'node:crypto';
import { PostgrestError } from '@supabase/supabase-js';
import type { CreateBrandInput } from '../schemas/admin.schema';
import { STORE_LIST_MAX } from '../schemas/limits';
import { NEW_STORE_SLUG_PATTERN } from '../schemas/store.schema';
import { INVITE_EXPIRY_DAYS } from '../schemas/team.schema';
import type { RequestContext } from '../types/auth';
import type { AdminBrandDto, BrandInviteDto } from '../types/api';
import { brandHasOwner, notFound, slugTaken, validationError } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { logger } from '../utils/logger';
import { toAdminBrandDto, toBrandInviteDto } from '../utils/serializers';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';
import { slugFromName } from './brand.service';
import { audited, DAY_MS, hashToken } from './team.service';

// Restaurant onboarding for platform admins (plans/P7_4A_ONBOARDING.md): a brand, then an invite for its owner, whose
// link the admin shares. Every route here is behind requireAdmin; none is cached (owner and invitee emails).

const INVITE_SELECT = 'id, email, expires_at, created_at';
const BRAND_SELECT =
  'id, name, slug, created_at, owner:profiles!brands_owner_id_fkey (id, name, email), branches:stores!stores_brand_id_fkey (count)';
const SLUG_TAKEN_MESSAGE = 'Another restaurant already uses that web address. Choose another.';

/** Brands by name (all of them, or the ones in `ids`), each with its owner, branch count and open invite. */
async function loadBrands(ids?: string[]): Promise<AdminBrandDto[]> {
  let query = supabaseAdmin
    .from('brands')
    .select(BRAND_SELECT)
    .eq('branches.is_template', false)
    .order('name')
    // One past the cap, so the warning below fires only when a brand is really left out.
    .limit(STORE_LIST_MAX + 1);
  if (ids) query = query.in('id', ids);
  const { data: found } = await query.throwOnError();
  // The cap is a safety valve: say so when it bites, or a brand missing from the list is a silent mystery.
  if (found.length > STORE_LIST_MAX) logger.warn({ shown: STORE_LIST_MAX }, 'Brands truncated');
  const brands = found.slice(0, STORE_LIST_MAX);
  if (brands.length === 0) return [];

  const { data: invites } = await supabaseAdmin
    .from('brand_invites')
    .select(`brand_id, ${INVITE_SELECT}`)
    .in(
      'brand_id',
      brands.map((b) => b.id),
    )
    .is('accepted_at', null)
    .is('revoked_at', null)
    .throwOnError();
  return brands.map((brand) =>
    toAdminBrandDto(
      brand,
      invites.find((i) => i.brand_id === brand.id),
    ),
  );
}

export const listBrands = (): Promise<AdminBrandDto[]> => loadBrands();

/** A new ACTIVE brand with its empty template (create_brand); the slug is made from the name when not given. */
export async function createBrand(
  input: CreateBrandInput,
  ctx: RequestContext,
): Promise<AdminBrandDto> {
  const slug = input.slug ?? slugFromName(input.name);
  if (!NEW_STORE_SLUG_PATTERN.test(slug))
    throw validationError(
      'The name is too short to make a web address: choose one of lower-case letters, digits and dashes.',
      'slug',
    );
  let brandId: string;
  try {
    const { data } = await supabaseAdmin
      .rpc('create_brand', {
        p_name: input.name,
        p_slug: slug,
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
    brandId = data;
  } catch (err) {
    // Only the brand's own slug is the admin's to change; any other collision (a template store's slug raced by a
    // branch of the same name) is not, and stays a 500.
    if (
      err instanceof PostgrestError &&
      err.code === '23505' &&
      err.message.includes('brands_slug_key')
    )
      throw slugTaken(SLUG_TAKEN_MESSAGE);
    throw err;
  }
  const [brand] = await loadBrands([brandId]);
  // Just made in this request: missing would mean the read went to another database.
  if (!brand) throw new Error('A new brand was not found');
  return brand;
}

/**
 * An owner invite for an ownerless brand, and its token, returned here once and never again. A new invite replaces
 * the open one (the answer to "the link was lost"); a brand that has its owner is 409, since no invite replaces one.
 * One transaction (create_brand_invite), so a revoked old link always comes with a working new one.
 */
export async function createOwnerInvite(
  brandId: string,
  email: string,
  ctx: RequestContext,
  now = new Date(),
): Promise<{ invite: BrandInviteDto; token: string }> {
  if (!isUuid(brandId)) throw notFound('Restaurant not found.');
  // accept_brand_invite refuses an ADMIN (D6), so such an invite could never be accepted: say so now, not as a dead link.
  const { data: admin } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .eq('role', 'ADMIN')
    .maybeSingle()
    .throwOnError();
  if (admin)
    throw validationError(
      "That email belongs to a platform admin, and an admin can't own a restaurant. Invite the owner's own account.",
      'email',
    );
  const token = randomBytes(32).toString('base64url');
  try {
    const { data } = await supabaseAdmin
      .rpc('create_brand_invite', {
        p_brand_id: brandId.toLowerCase(),
        p_email: email,
        p_token_hash: hashToken(token),
        p_expires_at: new Date(now.getTime() + INVITE_EXPIRY_DAYS * DAY_MS).toISOString(),
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
        p_now: now.toISOString(),
      })
      .throwOnError();
    return { invite: toBrandInviteDto(data), token };
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND')) throw notFound('Restaurant not found.');
    if (raisedByDatabase(err, 'BRAND_HAS_OWNER')) throw brandHasOwner();
    throw err;
  }
}

/**
 * Closes an open owner invite of this brand, and says whether it did: twice is a no-op (false); another brand's, or an
 * accepted one, is 404.
 */
export async function revokeOwnerInvite(
  brandId: string,
  inviteId: string,
  ctx: RequestContext,
): Promise<boolean> {
  if (!isUuid(brandId) || !isUuid(inviteId)) throw notFound('Invite not found.');
  const { data: invite } = await supabaseAdmin
    .from('brand_invites')
    .select('accepted_at, revoked_at')
    .eq('id', inviteId.toLowerCase())
    .eq('brand_id', brandId.toLowerCase())
    .maybeSingle()
    .throwOnError();
  if (!invite || invite.accepted_at) throw notFound('Invite not found.');
  if (invite.revoked_at) return false;
  const { data: closed } = await audited(
    supabaseAdmin
      .from('brand_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inviteId.toLowerCase())
      // Accepted since the read above: the CHECK forbids revoking it, and there is nothing left to revoke.
      .is('accepted_at', null)
      .is('revoked_at', null)
      .select('accepted_at'),
    ctx,
  ).throwOnError();
  if (closed.length > 0) return true;
  // Changed since the read: accepted (it is the brand's owner's now, nothing to revoke) or revoked by someone else.
  const { data: now } = await supabaseAdmin
    .from('brand_invites')
    .select('accepted_at')
    .eq('id', inviteId.toLowerCase())
    .single()
    .throwOnError();
  if (now.accepted_at) throw notFound('Invite not found.');
  return false;
}
