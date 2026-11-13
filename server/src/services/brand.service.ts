import { PostgrestError } from '@supabase/supabase-js';
import { LIMITS, STORE_LIST_MAX } from '../schemas/limits';
import { NEW_STORE_SLUG_PATTERN, type CreateStoreInput } from '../schemas/store.schema';
import type { AuthUser, RequestContext } from '../types/auth';
import type { ManagedStoreDto, MyBrandDto } from '../types/api';
import { notFound, slugTaken, validationError } from '../utils/errors';
import { isUuid } from '../utils/ids';
import { logger } from '../utils/logger';
import { toManagedStoreDto } from '../utils/serializers';
import type { PushTemplateInput } from '../schemas/menuItem.schema';
import { raisedByDatabase, supabaseAdmin } from '../utils/supabase';
import { invalidateMenus } from './menu.service';
import { getStore } from './store.service';

/** A brand route is its owner's alone: anyone else, an admin included, gets the 404 of a brand they cannot see. */
function assertOwnsBrand(brandId: string, user: Pick<AuthUser, 'ownedBrandIds'>): void {
  if (!isUuid(brandId) || !user.ownedBrandIds.includes(brandId.toLowerCase()))
    throw notFound('Brand not found.');
}

/** The brands `user` owns, each with its branches (every status, oldest first) and its template. */
export async function listMyBrands(user: Pick<AuthUser, 'ownedBrandIds'>): Promise<MyBrandDto[]> {
  if (user.ownedBrandIds.length === 0) return [];
  const [{ data: brands }, { data: stores }] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('id, name, slug')
      .in('id', user.ownedBrandIds)
      .order('name')
      .throwOnError(),
    supabaseAdmin
      .from('stores')
      .select('*')
      .in('brand_id', user.ownedBrandIds)
      .order('created_at')
      .order('id')
      .limit(STORE_LIST_MAX)
      .throwOnError(),
  ]);
  // The cap is a safety valve: say so when it bites, or a branch missing from the list is a silent mystery.
  if (stores.length === STORE_LIST_MAX)
    logger.warn({ shown: STORE_LIST_MAX }, 'Owned stores truncated');
  return brands.map((brand) => {
    const own = stores.filter((store) => store.brand_id === brand.id);
    const template = own.find((store) => store.is_template);
    return {
      ...brand,
      template: template ? toManagedStoreDto(template) : null,
      stores: own.filter((store) => !store.is_template).map(toManagedStoreDto),
    };
  });
}

/** The name as a slug: lower-case ASCII letters and digits, every other run one dash, cut to LIMITS.store.slugMax. */
export function slugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, LIMITS.store.slugMax)
    .replace(/^-+|-+$/g, '');
}

/**
 * Opens a branch of `brandId` as a DRAFT copy of its template (create_store_from_template). Only the brand's owner may:
 * anyone else, an admin included, gets the 404 of a brand they cannot see.
 */
export async function createStore(
  brandId: string,
  input: CreateStoreInput,
  user: Pick<AuthUser, 'ownedBrandIds'>,
  ctx: RequestContext,
): Promise<ManagedStoreDto> {
  assertOwnsBrand(brandId, user);
  const slug = input.slug ?? slugFromName(input.name);
  if (!NEW_STORE_SLUG_PATTERN.test(slug))
    throw validationError(
      `The name is too short to make a web address: choose one of ${LIMITS.store.slugMin}–${LIMITS.store.slugMax} lower-case letters, digits and dashes.`,
      'slug',
    );
  let storeId: string;
  try {
    const { data } = await supabaseAdmin
      .rpc('create_store_from_template', {
        p_brand_id: brandId.toLowerCase(),
        p_name: input.name,
        p_slug: slug,
        p_area: input.area ?? undefined,
        p_address_line: input.addressLine ?? undefined,
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
    storeId = data;
  } catch (err) {
    // The one unique column a new branch can collide on (the function rolls back, so nothing is left behind).
    if (err instanceof PostgrestError && err.code === '23505') throw slugTaken();
    throw err;
  }
  return toManagedStoreDto(await getStore(storeId));
}

/**
 * Sends chosen fields of chosen template items to chosen branches (push_template_items): a branch's copy, found by
 * lineage, is overwritten; a branch without one gets a new copy. Only the brand's owner may (anyone else gets 404), and
 * an item or a store outside the brand refuses the whole push. Returns the copies changed or created.
 */
export async function pushTemplate(
  brandId: string,
  input: PushTemplateInput,
  user: Pick<AuthUser, 'ownedBrandIds'>,
  ctx: RequestContext,
): Promise<number> {
  assertOwnsBrand(brandId, user);
  const storeIds = input.storeIds.map((id) => id.toLowerCase());
  let changed: number;
  try {
    const { data } = await supabaseAdmin
      .rpc('push_template_items', {
        p_brand_id: brandId.toLowerCase(),
        p_template_item_ids: input.itemIds.map((id) => id.toLowerCase()),
        p_store_ids: storeIds,
        p_fields: input.fields,
        p_actor: ctx.actor,
        p_request_id: ctx.requestId,
      })
      .throwOnError();
    changed = data;
  } catch (err) {
    if (raisedByDatabase(err, 'NOT_FOUND'))
      throw notFound('An item or a store is not part of this brand.');
    throw err;
  }
  storeIds.forEach(invalidateMenus);
  return changed;
}
