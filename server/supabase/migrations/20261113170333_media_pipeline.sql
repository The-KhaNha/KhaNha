-- P3.3 PR 10a: the image pipeline's queue and its one transition. The worker's media handler (src/jobs/media.ts)
-- consumes media.uploaded, makes the WebP variants and ends the upload here. Only media.uploaded is subscribed (not
-- media.*), so the media.processed / media.failed events this function emits never come back to the same queue.

select pgmq.create('q_media');
insert into public.event_subscriptions (event_type, queue_name) values ('media.uploaded', 'q_media');

-- UPLOADED → PROCESSED (with its variants) or FAILED (with the reason), and media.processed / media.failed in the same
-- transaction. An unknown upload is NOT_FOUND; one not UPLOADED changes nothing and emits nothing, so a redelivered
-- message is harmless. Returns whether this call moved it.
create function public.finish_media_upload(
  p_upload_id uuid,
  p_status public.media_upload_status,
  p_variants jsonb default null,
  p_failure text default null,
  p_actor jsonb default null,
  p_request_id text default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_upload record;
begin
  if p_status not in ('PROCESSED', 'FAILED')
     or (p_status = 'PROCESSED' and jsonb_typeof(p_variants) is distinct from 'array')
     or (p_status = 'FAILED' and p_failure is null) then
    raise exception using message = 'VALIDATION_ERROR';
  end if;
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  select id, store_id, status into v_upload
    from public.media_uploads
   where id = p_upload_id
     for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;
  if v_upload.status <> 'UPLOADED' then
    return false;
  end if;

  update public.media_uploads
     set status = p_status,
         variants = case when p_status = 'PROCESSED' then p_variants end,
         failure = case when p_status = 'FAILED' then left(p_failure, 500) end,
         processed_at = now()
   where id = p_upload_id;
  perform public.emit_event(
    case when p_status = 'PROCESSED' then 'media.processed' else 'media.failed' end,
    'media_upload', p_upload_id, v_upload.store_id,
    case when p_status = 'PROCESSED' then jsonb_build_object('variants', p_variants)
         else jsonb_build_object('failure', left(p_failure, 500)) end,
    p_actor, p_request_id
  );
  return true;
end;
$$;

revoke execute on function public.finish_media_upload(uuid, public.media_upload_status, jsonb, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.finish_media_upload(uuid, public.media_upload_status, jsonb, text, jsonb, text)
  to service_role;
