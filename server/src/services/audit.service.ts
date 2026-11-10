import { AUDIT_PAGE, type AuditQuery } from '../schemas/admin.schema';
import type { Tables } from '../types/database';
import { supabaseAdmin } from '../utils/supabase';

interface AuditPage {
  rows: Tables<'audit_log'>[];
  nextCursor: number | null;
}

/**
 * One page of the audit log, newest first, keyset-paged on the id (`before` = the last id of the previous page), so a
 * row written mid-walk never shifts a page. Admin-only and always fresh: never read through `cached()`.
 */
export async function listAudit(query: AuditQuery): Promise<AuditPage> {
  const limit = query.limit ?? AUDIT_PAGE.default;
  let select = supabaseAdmin
    .from('audit_log')
    .select(
      'id, occurred_at, actor_type, actor_id, actor_role, store_id, action, entity_type, entity_id, changes, reason, request_id',
    );
  if (query.entityType) select = select.eq('entity_type', query.entityType);
  if (query.entityId) select = select.eq('entity_id', query.entityId);
  if (query.actorId) select = select.eq('actor_id', query.actorId);
  if (query.from) select = select.gte('occurred_at', query.from);
  if (query.to) select = select.lt('occurred_at', query.to);
  if (query.before) select = select.lt('id', query.before);

  // One row past the page tells whether another page exists, so the last page says so without an empty extra read.
  const { data } = await select
    .order('id', { ascending: false })
    .limit(limit + 1)
    .throwOnError();
  const rows = data.slice(0, limit);
  return { rows, nextCursor: data.length > limit ? (rows.at(-1)?.id ?? null) : null };
}
