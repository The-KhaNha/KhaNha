-- P3.3 PR 10b: the nightly media sweep. Only the worker can reach the store, so the schedule emits media.sweep to
-- q_media and the media handler removes the objects; this function only decides what may go. There is no SQL-only
-- purge: it would drop a row while its objects stay in storage.

insert into public.event_subscriptions (event_type, queue_name) values ('media.sweep', 'q_media');

-- An old order line keeps the photo it was placed with; the sweep checks each variant against it.
create index order_items_media_image_idx on public.order_items (image_url) where image_url like '/media/%';

-- Whether anything shows one of an upload's variants: a menu item (its image_url or image_variants) or an order line
-- (an old order keeps the photo it was placed with). Paths are `/media/<key>` (integrations/media publicPath).
create function public.media_upload_shown(p_upload_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.media_uploads u, jsonb_to_recordset(coalesce(u.variants, '[]')) as v(key text)
     where u.id = p_upload_id
       and v.key is not null
       and (exists (select 1 from public.menu_items m
                     where m.image_url = '/media/' || v.key
                        or m.image_variants @> jsonb_build_array(jsonb_build_object('key', v.key)))
            or exists (select 1 from public.order_items o
                        where o.image_url like '/media/%' and o.image_url = '/media/' || v.key))
  );
$$;

-- The uploads the sweep may delete, oldest first, each with the variant keys it may remove with it:
--   * PENDING, UPLOADED or FAILED and started more than 24 hours before p_now (abandoned, or never processable);
--   * PROCESSED more than 24 hours before p_now, when nothing shows any of its variants (media_upload_shown). A
--     processed upload stays while it is shown, so a photo replaced later is still found here and swept then.
-- Variants are content-addressed, so two uploads of the same photo share keys: a key is removed only when no upload
-- that stays (not in this batch) lists it either.
create function public.media_sweep_candidates(p_now timestamptz default now(), p_limit integer default 50)
returns table (upload_id uuid, original_key text, remove_keys text[])
language sql
stable
set search_path = ''
as $$
  with doomed as (
    select u.id, u.original_key, u.variants, u.created_at
      from public.media_uploads u
     where (u.status in ('PENDING', 'UPLOADED', 'FAILED') and u.created_at < p_now - interval '24 hours')
        or (u.status = 'PROCESSED' and u.processed_at < p_now - interval '24 hours'
            and not public.media_upload_shown(u.id))
     order by u.created_at
     limit p_limit
  )
  select d.id,
         d.original_key,
         coalesce(array(
           select v.key
             from jsonb_to_recordset(coalesce(d.variants, '[]')) as v(key text)
            where v.key is not null
              and not exists (
                select 1
                  from public.media_uploads o, jsonb_to_recordset(coalesce(o.variants, '[]')) as w(key text)
                 where w.key = v.key and o.id not in (select id from doomed)
              )
         ), '{}')
    from doomed d
   order by d.created_at;
$$;

revoke execute on function public.media_upload_shown(uuid) from public, anon, authenticated;
grant execute on function public.media_upload_shown(uuid) to service_role;
revoke execute on function public.media_sweep_candidates(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.media_sweep_candidates(timestamptz, integer) to service_role;

-- 03:07 IST, after the other nightly purges. The worker reads the time from the event, so a late delivery sweeps by
-- the time the sweep was asked for.
select cron.schedule(
  'media-sweep',
  '37 21 * * *',
  $$select public.emit_event('media.sweep', 'media', gen_random_uuid(), null, '{}'::jsonb,
                              '{"type": "SCHEDULER"}'::jsonb, null)$$
);
