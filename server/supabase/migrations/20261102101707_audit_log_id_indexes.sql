-- GET /api/admin/audit pages newest first on the id (`order by id desc`, `id < before`), so its filtered reads need
-- indexes that end in the id, not in occurred_at: with occurred_at last, a filter on a busy entity type or actor sorted
-- every matching row before taking one page. The occurred_at range filter still applies on the rows the index yields.
-- No reader relies on the old order yet (PR 07 is the first).

drop index public.audit_log_entity_idx;
drop index public.audit_log_store_idx;
drop index public.audit_log_actor_idx;

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, id desc);
-- entityType alone: the index above cannot give the id order once entity_id sits between.
create index audit_log_entity_type_idx on public.audit_log (entity_type, id desc);
create index audit_log_store_idx on public.audit_log (store_id, id desc);
create index audit_log_actor_idx on public.audit_log (actor_id, id desc);
