alter table public.site_settings
  add column if not exists background_music_name text not null default '';
