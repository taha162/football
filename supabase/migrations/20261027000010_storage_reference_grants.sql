-- =============================================================================
-- Storage buckets & policies, reference data, and API privileges.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Storage. Paths are "<owner-entity-id>/<file>". Images are public-read;
-- writes are restricted to the owning user / team managers / venue managers.
-- Size and MIME limits are enforced by the bucket and again by the server.
-- ---------------------------------------------------------------------------
create or replace function private.try_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function private.can_manage_venue(p_venue uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.venue_staff
                 where venue_id = p_venue and user_id = (select auth.uid()) and role in ('owner', 'manager'));
$$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
      ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
      ('team-logos', 'team-logos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
      ('venue-images', 'venue-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    execute $p$
      create policy "avatars_write_own" on storage.objects for insert to authenticated
        with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "avatars_modify_own" on storage.objects for update to authenticated
        using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "avatars_delete_own" on storage.objects for delete to authenticated
        using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
    $p$;
    execute $p$
      create policy "team_logos_write" on storage.objects for insert to authenticated
        with check (bucket_id = 'team-logos' and private.is_team_manager(private.try_uuid((storage.foldername(name))[1])))
    $p$;
    execute $p$
      create policy "team_logos_modify" on storage.objects for update to authenticated
        using (bucket_id = 'team-logos' and private.is_team_manager(private.try_uuid((storage.foldername(name))[1])))
    $p$;
    execute $p$
      create policy "team_logos_delete" on storage.objects for delete to authenticated
        using (bucket_id = 'team-logos' and private.is_team_manager(private.try_uuid((storage.foldername(name))[1])))
    $p$;
    execute $p$
      create policy "venue_images_write" on storage.objects for insert to authenticated
        with check (bucket_id = 'venue-images' and private.can_manage_venue(private.try_uuid((storage.foldername(name))[1])))
    $p$;
    execute $p$
      create policy "venue_images_modify" on storage.objects for update to authenticated
        using (bucket_id = 'venue-images' and private.can_manage_venue(private.try_uuid((storage.foldername(name))[1])))
    $p$;
    execute $p$
      create policy "venue_images_delete" on storage.objects for delete to authenticated
        using (bucket_id = 'venue-images' and private.can_manage_venue(private.try_uuid((storage.foldername(name))[1])))
    $p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reference data. Mosul is the launch city; further cities are added by
-- administrators (admin_upsert_city). Area coordinates are intentionally left
-- empty until verified; distance features fall back to venue coordinates.
-- ---------------------------------------------------------------------------
insert into public.currencies (code, minor_unit_exponent, name_en, name_ar) values
  ('IQD', 0, 'Iraqi dinar', 'دينار عراقي'),
  ('USD', 2, 'US dollar', 'دولار أمريكي');

insert into public.cities (slug, name_en, name_ar, country_code, timezone, currency, latitude, longitude, is_active, sort_order) values
  ('mosul', 'Mosul', 'الموصل', 'IQ', 'Asia/Baghdad', 'IQD', 36.340000, 43.130000, true, 1);

insert into public.areas (city_id, slug, name_en, name_ar)
select c.id, a.slug, a.name_en, a.name_ar from public.cities c,
  (values
    ('al-zuhur', 'Al-Zuhur', 'الزهور'),
    ('al-muhandisin', 'Al-Muhandisin', 'المهندسين'),
    ('al-nabi-yunus', 'Al-Nabi Yunus', 'النبي يونس'),
    ('al-majmua-al-thaqafiya', 'Al-Majmua Al-Thaqafiya', 'المجموعة الثقافية'),
    ('al-hadbaa', 'Al-Hadbaa', 'الحدباء'),
    ('al-karama', 'Al-Karama', 'الكرامة'),
    ('al-sukkar', 'Al-Sukkar', 'السكر'),
    ('al-muthanna', 'Al-Muthanna', 'المثنى'),
    ('al-arabi', 'Al-Arabi', 'العربي'),
    ('al-baladiyat', 'Al-Baladiyat', 'البلديات'),
    ('al-faisaliya', 'Al-Faisaliya', 'الفيصلية'),
    ('al-jamiaa', 'University area', 'منطقة الجامعة'),
    ('al-dawasa', 'Al-Dawasa', 'الدواسة'),
    ('al-zanjili', 'Al-Zanjili', 'الزنجيلي'),
    ('al-yarmuk', 'Al-Yarmuk', 'اليرموك'),
    ('wadi-hajar', 'Wadi Hajar', 'وادي حجر'),
    ('al-mosul-al-jadida', 'New Mosul', 'الموصل الجديدة'),
    ('al-tayaran', 'Al-Tayaran', 'الطيران')
  ) as a(slug, name_en, name_ar)
where c.slug = 'mosul';

-- ---------------------------------------------------------------------------
-- Privileges: read through RLS, write only through RPCs.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.run_scheduled_jobs() from authenticated;
grant execute on function public.run_scheduled_jobs() to service_role;

-- Functions guests may call (all read-only).
grant execute on function
  public.search_matches(uuid, uuid, date, date, time, time, public.match_format, public.skill_level, bigint,
                        public.player_position, int, boolean, public.match_join_policy, boolean, numeric, numeric,
                        numeric, text, int, int, text),
  public.quote_booking(uuid, timestamp, int),
  public.field_busy_intervals(uuid, date),
  public.match_transition_allowed(public.match_status, public.match_status),
  public.tournament_transition_allowed(public.tournament_status, public.tournament_status),
  public.player_stats(uuid),
  public.player_reputation(uuid),
  public.venue_rating(uuid)
to anon;

-- Helpers evaluated inside RLS policies / invoker functions.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_role(public.app_role),
  private.is_admin(),
  private.is_moderator(),
  private.is_team_member(uuid),
  private.is_team_manager(uuid, uuid),
  private.can_view_team(uuid),
  private.is_venue_staff(uuid),
  private.can_view_venue(uuid),
  private.can_manage_venue(uuid),
  private.can_view_match(uuid),
  private.is_match_organizer(uuid, uuid),
  private.is_confirmed_participant(uuid, uuid),
  private.can_view_challenge(uuid),
  private.can_access_conversation(uuid, uuid),
  private.can_view_tournament(uuid),
  private.distance_km(numeric, numeric, numeric, numeric),
  private.try_uuid(text),
  private.is_valid_timezone(text)
to anon, authenticated;

-- Future objects created by the migration owner follow the same rules.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
