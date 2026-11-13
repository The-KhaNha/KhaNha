-- P3.3 media: one row per photo a store's manager uploads. The API makes the row and the storage key (never the
-- client), the bytes go straight to storage (S3 from PR 09; a local folder on a developer's machine), and `complete`
-- marks it UPLOADED and emits media.uploaded, which the image pipeline (PR 10) turns into variants. Read and written
-- only by the API (service_role).

create type public.media_upload_status as enum ('PENDING', 'UPLOADED', 'PROCESSED', 'FAILED');

create table public.media_uploads (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  created_by uuid references public.profiles (id) on delete set null,
  status public.media_upload_status not null default 'PENDING',
  -- stores/<store id>/uploads/<upload id>.<ext>: made by the API from the row, so no client value names a path.
  original_key text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 8388608),
  variants jsonb,
  failure text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- The pipeline and a future sweep of abandoned uploads look rows up by status and age.
create index media_uploads_status_created_idx on public.media_uploads (status, created_at);
create index media_uploads_store_idx on public.media_uploads (store_id, created_at desc);

alter table public.media_uploads enable row level security;
revoke all on public.media_uploads from anon, authenticated;

-- PENDING → UPLOADED once the bytes are in storage (the service checks their size first), and media.uploaded in the same
-- transaction. Another store's or an unknown upload is NOT_FOUND; one already past PENDING changes nothing and emits
-- nothing (a repeated `complete` is not an error). Returns whether this call moved it.
create function public.complete_media_upload(
  p_store_id uuid,
  p_upload_id uuid,
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
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);

  select id, status, original_key, content_type, byte_size into v_upload
    from public.media_uploads
   where id = p_upload_id and store_id = p_store_id
     for update;
  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;
  if v_upload.status <> 'PENDING' then
    return false;
  end if;

  update public.media_uploads set status = 'UPLOADED' where id = p_upload_id;
  perform public.emit_event(
    'media.uploaded', 'media_upload', p_upload_id, p_store_id,
    jsonb_build_object('key', v_upload.original_key, 'contentType', v_upload.content_type, 'byteSize', v_upload.byte_size),
    p_actor, p_request_id
  );
  return true;
end;
$$;

revoke execute on function public.complete_media_upload(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_media_upload(uuid, uuid, jsonb, text) to service_role;
