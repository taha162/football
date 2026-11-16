-- =============================================================================
-- Richer promotions: a picture, a place and a link (Admin → Promotions).
--
-- - whatsapp_campaigns gains, all optional:
--     image_path  a JPG or PNG in the new public bucket promo-images, which
--                 only admins may write to (WhatsApp fetches it from there,
--                 through the bot);
--     place_*     a venue's coordinates, name and address, copied when the
--                 campaign starts, so editing the venue later changes nothing
--                 already sent;
--     link_url    an https address, added under the text.
-- - admin_start_promo_campaign takes them; calls with the text and the city
--   alone still work.
-- - wa_outbox_claim hands them to the worker, which passes them to the bot.
-- - admin_whatsapp_campaigns shows them in the campaigns table.
-- - admin_whatsapp_summary says schema 31, for Admin → Settings.
--
-- Safe to run twice. No data changes.
-- =============================================================================

alter table public.whatsapp_campaigns
  add column if not exists image_path text,
  add column if not exists place_lat double precision,
  add column if not exists place_lng double precision,
  add column if not exists place_name text,
  add column if not exists place_address text,
  add column if not exists link_url text;

alter table public.whatsapp_campaigns drop constraint if exists whatsapp_campaigns_image_path_check;
alter table public.whatsapp_campaigns add constraint whatsapp_campaigns_image_path_check
  check (image_path is null or image_path ~ '^[0-9a-f-]{36}\.(jpg|png)$');
alter table public.whatsapp_campaigns drop constraint if exists whatsapp_campaigns_place_check;
alter table public.whatsapp_campaigns add constraint whatsapp_campaigns_place_check
  check ((place_lat is null) = (place_lng is null)
         and (place_lat is null or (place_lat between -90 and 90 and place_lng between -180 and 180))
         and (place_name is null or char_length(place_name) <= 100)
         and (place_address is null or char_length(place_address) <= 200));
alter table public.whatsapp_campaigns drop constraint if exists whatsapp_campaigns_link_url_check;
alter table public.whatsapp_campaigns add constraint whatsapp_campaigns_link_url_check
  check (link_url is null or (link_url ~ '^https://[^[:space:]]+$' and char_length(link_url) <= 500));

-- The pictures: public (WhatsApp fetches them through the bot), written by admins only.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('promo-images', 'promo-images', true, 5242880, array['image/jpeg', 'image/png'])
    on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists promo_images_write on storage.objects';
    execute $p$
      create policy promo_images_write on storage.objects for insert to authenticated
        with check (bucket_id = 'promo-images' and private.is_admin())
    $p$;
    execute 'drop policy if exists promo_images_delete on storage.objects';
    execute $p$
      create policy promo_images_delete on storage.objects for delete to authenticated
        using (bucket_id = 'promo-images' and private.is_admin())
    $p$;
  end if;
end $$;

drop function if exists public.admin_start_promo_campaign(text, uuid);
drop function if exists public.admin_start_promo_campaign(text, uuid, text, uuid, text);
create function public.admin_start_promo_campaign(
  p_body text,
  p_city_id uuid default null,
  p_image_path text default null,
  p_venue_id uuid default null,
  p_link_url text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_body text := btrim(coalesce(p_body, ''));
  v_image text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_link text := nullif(btrim(coalesce(p_link_url, '')), '');
  v_venue public.venues%rowtype;
  v_id uuid;
  v_count int;
begin
  if char_length(v_body) not between 5 and 1000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  if p_city_id is not null and not exists (select 1 from public.cities where id = p_city_id) then
    raise exception 'invalid_city' using errcode = '22023';
  end if;
  -- A picture uploaded to promo-images (by an admin: nobody else may write there).
  if v_image is not null and (v_image !~ '^[0-9a-f-]{36}\.(jpg|png)$'
      or not exists (select 1 from storage.objects o where o.bucket_id = 'promo-images' and o.name = v_image)) then
    raise exception 'invalid_image' using errcode = '22023';
  end if;
  if v_link is not null and (v_link !~ '^https://[^[:space:]]+$' or char_length(v_link) > 500) then
    raise exception 'invalid_link' using errcode = '22023';
  end if;
  if p_venue_id is not null then
    select * into v_venue from public.venues where id = p_venue_id;
    if not found then
      raise exception 'venue_not_found' using errcode = 'P0002';
    end if;
    if v_venue.latitude is null or v_venue.longitude is null then
      raise exception 'venue_without_location' using errcode = 'P0001';
    end if;
  end if;
  -- One campaign at a time, so the daily limit isn't split.
  perform pg_advisory_xact_lock(hashtextextended('wa_campaign', 0));
  if exists (select 1 from public.whatsapp_campaigns where status = 'sending') then
    raise exception 'campaign_in_progress' using errcode = 'P0001';
  end if;
  insert into public.whatsapp_campaigns (body, city_id, created_by, image_path, place_lat, place_lng, place_name, place_address, link_url)
  values (v_body, p_city_id, v_uid, v_image, v_venue.latitude, v_venue.longitude,
          case when p_venue_id is not null then left(v_venue.name, 100) end,
          case when p_venue_id is not null then left(nullif(btrim(coalesce(v_venue.address, '')), ''), 200) end,
          v_link)
  returning id into v_id;
  insert into public.outbound_messages (user_id, phone, kind, campaign_id)
  select a.user_id, a.phone, 'promo', v_id from private.wa_promo_audience(p_city_id) a;
  get diagnostics v_count = row_count;
  update public.whatsapp_campaigns
     set recipients = v_count,
         status = case when v_count = 0 then 'done' else 'sending' end::public.campaign_status,
         finished_at = case when v_count = 0 then now() end
   where id = v_id;
  perform private.audit('whatsapp_campaign_started', 'whatsapp_campaign', v_id::text,
    jsonb_build_object('recipients', v_count, 'city_id', p_city_id, 'characters', char_length(v_body),
                       'image', v_image is not null, 'place', p_venue_id, 'link', v_link is not null));
  return jsonb_build_object('campaign_id', v_id, 'recipients', v_count);
end $$;

drop function if exists public.admin_whatsapp_campaigns(int);
create function public.admin_whatsapp_campaigns(p_limit int default 20)
returns table (id uuid, body text, city_id uuid, status public.campaign_status, recipients int, created_by_name text,
               created_at timestamptz, stopped_at timestamptz, finished_at timestamptz,
               queued int, sending int, sent int, failed int, skipped int,
               image_path text, place_name text, link_url text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  return query
    select c.id, c.body, c.city_id, c.status, c.recipients, p.display_name, c.created_at, c.stopped_at, c.finished_at,
           (count(m.id) filter (where m.status = 'queued'))::int,
           (count(m.id) filter (where m.status = 'sending'))::int,
           (count(m.id) filter (where m.status = 'sent'))::int,
           (count(m.id) filter (where m.status = 'failed'))::int,
           (count(m.id) filter (where m.status = 'skipped'))::int,
           c.image_path, c.place_name, c.link_url
      from public.whatsapp_campaigns c
      left join public.profiles p on p.id = c.created_by
      left join public.outbound_messages m on m.campaign_id = c.id
     group by c.id, p.display_name
     order by c.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;

-- As in 0028, with each promotion's picture, place and link for the worker.
drop function if exists public.wa_outbox_claim(int);
create function public.wa_outbox_claim(p_limit int default null)
returns table (id uuid, kind public.outbound_kind, phone text, body text, payload jsonb,
               recipient_name text, campaign_body text,
               campaign_image text, campaign_place jsonb, campaign_link text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, private.setting_int('whatsapp.batch_size', 10)), 1), 100);
  v_max int := greatest(private.setting_int('whatsapp.max_attempts', 3), 1);
  v_ids uuid[];
  v_more uuid[];
  v_room int;
begin
  -- Two runs at once never hand the same message twice nor overshoot today's limit.
  perform pg_advisory_xact_lock(hashtextextended('wa_outbox_claim', 0));

  -- Handed over hours ago and never reported: the bot lost them (for
  -- example a restart without its volume). Hand them again, within the attempts.
  update public.outbound_messages m
     set status = case when m.attempts >= v_max then 'failed' else 'queued' end::public.outbound_status,
         error = case when m.attempts >= v_max then 'no_report' else m.error end,
         handed_at = null, updated_at = now()
   where m.status = 'sending' and m.handed_at < now() - interval '6 hours';

  perform private.wa_skip_ineligible();
  perform private.wa_finish_campaigns();

  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select m.id from public.outbound_messages m
     where m.status = 'queued' and m.kind = 'booking' and m.next_attempt_at <= now()
     order by m.created_at
     limit v_limit
     for update skip locked) x;

  v_room := least(v_limit - cardinality(v_ids), private.wa_promo_allowance());
  if v_room > 0 then
    select coalesce(array_agg(x.id), '{}') into v_more from (
      select m.id from public.outbound_messages m
       where m.status = 'queued' and m.kind = 'promo' and m.next_attempt_at <= now()
       order by m.created_at
       limit v_room
       for update skip locked) x;
    v_ids := v_ids || v_more;
  end if;

  return query
    with claimed as (
      update public.outbound_messages m
         set status = 'sending', attempts = m.attempts + 1, handed_at = now(),
             first_handed_at = coalesce(m.first_handed_at, now()), updated_at = now()
       where m.id = any(v_ids)
       returning m.id, m.kind, m.phone, m.body, m.payload, m.user_id, m.campaign_id, m.created_at
    )
    select c.id, c.kind, c.phone, c.body, c.payload, p.display_name, w.body,
           w.image_path,
           case when w.place_lat is not null then jsonb_build_object(
             'lat', w.place_lat, 'lng', w.place_lng, 'name', w.place_name, 'address', w.place_address) end,
           w.link_url
      from claimed c
      left join public.profiles p on p.id = c.user_id
      left join public.whatsapp_campaigns w on w.id = c.campaign_id
     order by c.kind, c.created_at;
end $$;

create or replace function public.admin_whatsapp_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_day timestamptz := ((now() at time zone 'Asia/Baghdad')::date)::timestamp at time zone 'Asia/Baghdad';
begin
  perform private.require_admin();
  return jsonb_build_object(
    'schema', 31,
    'booking_messages', private.setting_bool('whatsapp.booking_messages', false),
    'promo_left_today', private.wa_promo_allowance(),
    'sent_today', (select count(*)::int from public.outbound_messages where sent_at >= v_day),
    'failed_today', (select count(*)::int from public.outbound_messages where status = 'failed' and updated_at >= v_day),
    'queued', (select count(*)::int from public.outbound_messages where status = 'queued'),
    'sending', (select count(*)::int from public.outbound_messages where status = 'sending'),
    'opted_in', (select count(*)::int from private.wa_promo_audience(null)));
end $$;

-- Grants as in 0028: the worker's claim for the server only; the admin functions
-- for signed-in people, each checking the admin role itself.
revoke all on function public.wa_outbox_claim(int) from public, anon, authenticated;
grant execute on function public.wa_outbox_claim(int) to service_role;
revoke all on function
  public.admin_start_promo_campaign(text, uuid, text, uuid, text),
  public.admin_whatsapp_campaigns(int)
from public, anon;
grant execute on function
  public.admin_start_promo_campaign(text, uuid, text, uuid, text),
  public.admin_whatsapp_campaigns(int)
to authenticated;
