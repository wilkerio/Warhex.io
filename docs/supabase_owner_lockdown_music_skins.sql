-- Run in Supabase SQL Editor (after supabase_security_hardening_v2.sql).
-- Objective: only owner can MANAGE music/skins catalog assets (insert/update/delete).
-- Players can still read/play/use what is already public.
--
-- How to use:
-- 1) Owner id already set in this script.
-- 2) Run this whole script.

begin;

-- ============================================================
-- Owner allowlist (single source of truth)
-- ============================================================

create table if not exists public.warhex_owner_ids (
  owner_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.warhex_owner_ids enable row level security;

revoke all on table public.warhex_owner_ids from anon, authenticated;

drop policy if exists "warhex_owner_ids_no_read" on public.warhex_owner_ids;
create policy "warhex_owner_ids_no_read"
on public.warhex_owner_ids
for select
to authenticated
using (false);

-- Put your account id here (auth.uid()).
insert into public.warhex_owner_ids(owner_id)
values ('ee412817-34de-4049-808c-46970a9c3dc9')
on conflict (owner_id) do nothing;

create or replace function public.warhex_is_owner()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid text;
begin
  -- service_role remains trusted.
  if public.warhex_is_service_role() then
    return true;
  end if;

  uid := auth.uid()::text;
  if uid is null or uid = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.warhex_owner_ids o
    where o.owner_id = uid
  );
end;
$$;

revoke all on function public.warhex_is_owner() from public;
grant execute on function public.warhex_is_owner() to anon, authenticated;

-- ============================================================
-- public.skins (catalog management owner-only)
-- ============================================================

do $$
begin
  if to_regclass('public.skins') is null then
    raise notice 'public.skins not found. Skipping.';
    return;
  end if;

  execute 'alter table public.skins enable row level security';
  execute 'revoke all on table public.skins from anon';
  execute 'grant select on table public.skins to anon, authenticated';
  execute 'grant insert, update, delete on table public.skins to authenticated';

  -- Keep read public (catalog consumption).
  execute 'drop policy if exists "skins_select_public" on public.skins';
  execute $sql$
    create policy "skins_select_public"
    on public.skins
    for select
    to anon, authenticated
    using (true)
  $sql$;

  -- Hard lock management to owner only.
  execute 'drop policy if exists "skins_insert_owner_only" on public.skins';
  execute 'drop policy if exists "skins_update_owner_only" on public.skins';
  execute 'drop policy if exists "skins_delete_owner_only" on public.skins';

  execute $sql$
    create policy "skins_insert_owner_only"
    on public.skins
    as restrictive
    for insert
    to authenticated
    with check (public.warhex_is_owner())
  $sql$;

  execute $sql$
    create policy "skins_update_owner_only"
    on public.skins
    as restrictive
    for update
    to authenticated
    using (public.warhex_is_owner())
    with check (public.warhex_is_owner())
  $sql$;

  execute $sql$
    create policy "skins_delete_owner_only"
    on public.skins
    as restrictive
    for delete
    to authenticated
    using (public.warhex_is_owner())
  $sql$;
end $$;

-- ============================================================
-- public.game_music_tracks (playlist management owner-only)
-- ============================================================

do $$
begin
  if to_regclass('public.game_music_tracks') is null then
    raise notice 'public.game_music_tracks not found. Skipping.';
    return;
  end if;

  execute 'alter table public.game_music_tracks enable row level security';
  execute 'revoke all on table public.game_music_tracks from anon';
  execute 'grant select on table public.game_music_tracks to anon, authenticated';
  execute 'grant insert, update, delete on table public.game_music_tracks to authenticated';

  -- Public reads only active rows; owner sees all rows.
  execute 'drop policy if exists "game_music_tracks_select_public_active" on public.game_music_tracks';
  execute $sql$
    create policy "game_music_tracks_select_public_active"
    on public.game_music_tracks
    for select
    to anon, authenticated
    using (coalesce(is_active, false) = true or public.warhex_is_owner())
  $sql$;

  execute 'drop policy if exists "game_music_tracks_insert_owner_only" on public.game_music_tracks';
  execute 'drop policy if exists "game_music_tracks_update_owner_only" on public.game_music_tracks';
  execute 'drop policy if exists "game_music_tracks_delete_owner_only" on public.game_music_tracks';

  execute $sql$
    create policy "game_music_tracks_insert_owner_only"
    on public.game_music_tracks
    as restrictive
    for insert
    to authenticated
    with check (public.warhex_is_owner())
  $sql$;

  execute $sql$
    create policy "game_music_tracks_update_owner_only"
    on public.game_music_tracks
    as restrictive
    for update
    to authenticated
    using (public.warhex_is_owner())
    with check (public.warhex_is_owner())
  $sql$;

  execute $sql$
    create policy "game_music_tracks_delete_owner_only"
    on public.game_music_tracks
    as restrictive
    for delete
    to authenticated
    using (public.warhex_is_owner())
  $sql$;
end $$;

-- ============================================================
-- storage.objects (music/skins buckets management owner-only)
-- ============================================================

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects not found. Skipping storage policies.';
    return;
  end if;

  -- Restrictive write lock for bucket music/skins.
  drop policy if exists "warhex_storage_music_skins_insert_owner_only" on storage.objects;
  drop policy if exists "warhex_storage_music_skins_update_owner_only" on storage.objects;
  drop policy if exists "warhex_storage_music_skins_delete_owner_only" on storage.objects;

  create policy "warhex_storage_music_skins_insert_owner_only"
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (bucket_id in ('music', 'skins') and public.warhex_is_owner());

  create policy "warhex_storage_music_skins_update_owner_only"
  on storage.objects
  as restrictive
  for update
  to authenticated
  using (bucket_id in ('music', 'skins') and public.warhex_is_owner())
  with check (bucket_id in ('music', 'skins') and public.warhex_is_owner());

  create policy "warhex_storage_music_skins_delete_owner_only"
  on storage.objects
  as restrictive
  for delete
  to authenticated
  using (bucket_id in ('music', 'skins') and public.warhex_is_owner());
end $$;

commit;

-- ============================================================
-- Quick tests (manual, with anon key / auth token)
-- ============================================================
-- Non-owner:
-- - insert/update/delete on public.skins -> must fail
-- - insert/update/delete on public.game_music_tracks -> must fail
-- - upload/delete in storage bucket music/skins -> must fail
--
-- Owner:
-- - same operations above -> must pass
