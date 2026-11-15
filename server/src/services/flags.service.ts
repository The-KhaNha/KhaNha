import { createHash } from 'node:crypto';
import { flagRulesSchema, type FlagRules, type UpdateFlagInput } from '../schemas/admin.schema';
import type { RequestContext } from '../types/auth';
import type { Tables } from '../types/database';
import type { Role } from '../types/enums';
import { cached, invalidate, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { notFound } from '../utils/errors';
import { logger } from '../utils/logger';
import { supabaseAdmin } from '../utils/supabase';

type FlagRow = Tables<'feature_flags'>;

/** A flag as evaluated: `rules` parsed. A row whose rules do not parse is off. */
export interface Flag {
  key: string;
  enabled: boolean;
  clientVisible: boolean;
  rules: FlagRules;
}

/** Who is asking. Each is optional: a signed-out caller has no user or role, a site-wide check no store. */
export interface FlagContext {
  userId?: string;
  role?: Role;
  storeId?: string;
}

/** Parses a row's rules. A hand-edited rule that does not parse turns the flag off rather than on for everyone. */
export function toFlag(row: Pick<FlagRow, 'key' | 'enabled' | 'client_visible' | 'rules'>): Flag {
  const rules = flagRulesSchema.safeParse(row.rules);
  const { key, client_visible: clientVisible } = row;
  if (rules.success) return { key, enabled: row.enabled, clientVisible, rules: rules.data };
  logger.warn({ flag: key }, 'Feature flag rules malformed, flag off');
  return { key, enabled: false, clientVisible, rules: {} };
}

/** 0–99, the same for one user and flag every time, and independent between flags. */
function percentBucket(key: string, userId: string): number {
  return createHash('sha256').update(`${key}:${userId}`).digest().readUInt32BE(0) % 100;
}

/** `enabled`, then the store list, then the role list, then the percentage. No user means outside the percentage. */
export function evaluateFlag(flag: Flag, ctx: FlagContext): boolean {
  const { storeIds, roles, percent } = flag.rules;
  if (!flag.enabled) return false;
  if (storeIds && !(ctx.storeId && storeIds.includes(ctx.storeId))) return false;
  if (roles && !(ctx.role && roles.includes(ctx.role))) return false;
  if (percent !== undefined)
    return ctx.userId ? percentBucket(flag.key, ctx.userId) < percent : false;
  return true;
}

/** Every flag, by key. Flags are not user data, so they share the public read cache; evaluation is per caller. */
export function getFlags(): Promise<Map<string, Flag>> {
  return cached('feature_flags', PUBLIC_READ_TTL_MS, async () => {
    const { data } = await supabaseAdmin
      .from('feature_flags')
      .select('key, enabled, client_visible, rules')
      // A stable order keeps /api/config's body, and so its ETag, the same for the same flags.
      .order('key')
      .throwOnError();
    return new Map(data.map((row) => [row.key, toFlag(row)]));
  });
}

/** An unknown key is off, so code can ship ahead of its flag's migration. */
export async function isEnabled(key: string, ctx: FlagContext): Promise<boolean> {
  const flag = (await getFlags()).get(key);
  return flag ? evaluateFlag(flag, ctx) : false;
}

export async function setFlag(
  key: string,
  input: UpdateFlagInput,
  ctx: RequestContext,
): Promise<FlagRow> {
  const { data } = await supabaseAdmin
    .from('feature_flags')
    .update({
      enabled: input.enabled,
      client_visible: input.clientVisible,
      rules: input.rules,
      updated_by: ctx.actor.id,
    })
    .eq('key', key)
    .select()
    .maybeSingle()
    // The audit trigger reads who and which request from these (the audit_log migration's audit_row_change explains why).
    .setHeader('x-actor', JSON.stringify(ctx.actor))
    .setHeader('x-request-id', ctx.requestId)
    .throwOnError();
  if (!data) throw notFound('There is no feature flag with that key.');
  invalidate('feature_flags');
  return data;
}
