create extension if not exists pgcrypto;

create table if not exists public.site_settings (
  id bigint primary key check (id = 1),
  background_music_url text not null default '',
  floating_video_url text not null default '',
  hero_headline text not null default 'Feel the heart beats',
  hero_subtitle text not null default 'Let the rhythm move through you.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_settings
  add column if not exists background_music_url text not null default '',
  add column if not exists floating_video_url text not null default '',
  add column if not exists hero_headline text not null default 'Feel the heart beats',
  add column if not exists hero_subtitle text not null default 'Let the rhythm move through you.',
  add column if not exists updated_at timestamptz not null default now();

insert into public.site_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  title text not null default '',
  subtitle text not null default '',
  photographer_name text not null default 'DJoz',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gallery_photos
  add column if not exists title text not null default '',
  add column if not exists subtitle text not null default '',
  add column if not exists photographer_name text not null default 'DJoz',
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.discography_releases (
  id uuid primary key default gen_random_uuid(),
  release_title text not null,
  track_title text not null,
  artist text not null default 'DJoz',
  audio_url text not null default '',
  release_url text not null default '',
  cover_art_url text not null default '',
  released_at date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_settings_updated_at on public.site_settings;
create trigger site_settings_updated_at
before update on public.site_settings
for each row execute function public.set_content_updated_at();

drop trigger if exists gallery_photos_updated_at on public.gallery_photos;
create trigger gallery_photos_updated_at
before update on public.gallery_photos
for each row execute function public.set_content_updated_at();

drop trigger if exists discography_releases_updated_at on public.discography_releases;
create trigger discography_releases_updated_at
before update on public.discography_releases
for each row execute function public.set_content_updated_at();

alter table public.site_settings enable row level security;
alter table public.gallery_photos enable row level security;
alter table public.discography_releases enable row level security;

drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read
on public.site_settings for select
to anon, authenticated
using (true);

drop policy if exists site_settings_admin_write on public.site_settings;
create policy site_settings_admin_write
on public.site_settings for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists gallery_photos_public_read on public.gallery_photos;
create policy gallery_photos_public_read
on public.gallery_photos for select
to anon, authenticated
using (true);

drop policy if exists gallery_photos_admin_write on public.gallery_photos;
create policy gallery_photos_admin_write
on public.gallery_photos for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists discography_releases_public_read on public.discography_releases;
create policy discography_releases_public_read
on public.discography_releases for select
to anon, authenticated
using (true);

drop policy if exists discography_releases_admin_write on public.discography_releases;
create policy discography_releases_admin_write
on public.discography_releases for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

grant select on public.site_settings, public.gallery_photos, public.discography_releases to anon, authenticated;
grant insert, update, delete on public.site_settings, public.gallery_photos, public.discography_releases to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('photos', 'photos', true, 524288000, array['image/*']),
  ('music', 'music', true, 524288000, array['audio/*']),
  ('videos', 'videos', true, 524288000, array['video/*'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists public_read_admin_media on storage.objects;
create policy public_read_admin_media
on storage.objects for select
to anon, authenticated
using (bucket_id in ('photos', 'music', 'videos'));

drop policy if exists admin_upload_media on storage.objects;
create policy admin_upload_media
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('photos', 'music', 'videos')
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists admin_update_media on storage.objects;
create policy admin_update_media
on storage.objects for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists admin_delete_media on storage.objects;
create policy admin_delete_media
on storage.objects for delete
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

do $$
declare
  target_table text;
begin
  foreach target_table in array array['site_settings', 'gallery_photos', 'discography_releases'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;