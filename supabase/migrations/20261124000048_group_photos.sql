-- =============================================================================
-- A group's photo (0048; after 0044).
--
-- Admins set it, change it or remove it; everyone in the group sees it (the
-- group page, the conversation's bar, the list of conversations).
-- - conversations.photo_path: <conversation id>/<random name>.jpg|png|webp in
--   the bucket `group-photos`. Like members' pictures (avatars), the bucket is
--   public, so photos load fast and are cached; the random names (the
--   group's id, and the photo's) are known only to the group's members.
-- - Only the site's server uploads, after checking the caller is an admin;
--   set_group_photo() checks again, and keeps only a file in that group's
--   folder. It returns the previous photo's name, which the server removes.
--
-- Adds a bucket, a column and a function; changes no existing data.
-- Safe to run twice.
-- =============================================================================

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('group-photos', 'group-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

alter table public.conversations add column if not exists photo_path text;
alter table public.conversations drop constraint if exists conversations_photo_path_check;
alter table public.conversations add constraint conversations_photo_path_check check (
  photo_path is null
  or (kind = 'group' and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$')
) not valid;
alter table public.conversations validate constraint conversations_photo_path_check;

-- Admins: the group's photo (a stored file in its folder), or none (null). Returns the one it replaced.
create or replace function public.set_group_photo(p_conversation_id uuid, p_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_group_admin(p_conversation_id);
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
  v_old text;
begin
  if v_path is not null and (
       v_path !~ ('^' || p_conversation_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'group-photos' and o.name = v_path)) then
    raise exception 'invalid_image' using errcode = '22023';
  end if;
  select photo_path into v_old from public.conversations where id = p_conversation_id;
  update public.conversations set photo_path = v_path where id = p_conversation_id;
  return v_old;
end $$;

revoke all on function public.set_group_photo(uuid, text) from public, anon;
grant execute on function public.set_group_photo(uuid, text) to authenticated;
