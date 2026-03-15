-- Run in Supabase SQL Editor.
-- Purpose:
-- 1) Make global account rank readable.
-- 2) Allow authenticated users to publish base layouts.
-- 3) Keep public base browser readable by everyone.

begin;

-- =========================
-- users (global rank source)
-- =========================
alter table if exists public.users enable row level security;

drop policy if exists "users_select_leaderboard_public" on public.users;
create policy "users_select_leaderboard_public"
on public.users
for select
to anon, authenticated
using (true);

grant select on table public.users to anon, authenticated;

-- =========================
-- base_layouts (publish/load)
-- =========================
alter table if exists public.base_layouts enable row level security;

drop policy if exists "base_layouts_select_public" on public.base_layouts;
drop policy if exists "base_layouts_insert_auth" on public.base_layouts;
drop policy if exists "base_layouts_update_own" on public.base_layouts;
drop policy if exists "base_layouts_delete_own" on public.base_layouts;

-- Public read policy adapts to schema variations (is_public/public/no visibility column).
do $$
declare
  has_is_public boolean;
  has_public boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='base_layouts' and column_name='is_public'
  ) into has_is_public;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='base_layouts' and column_name='public'
  ) into has_public;

  if has_is_public then
    execute $sql$
      create policy "base_layouts_select_public"
      on public.base_layouts
      for select
      to anon, authenticated
      using (coalesce(is_public, false) = true)
    $sql$;
  elsif has_public then
    execute $sql$
      create policy "base_layouts_select_public"
      on public.base_layouts
      for select
      to anon, authenticated
      using (coalesce(public, false) = true)
    $sql$;
  else
    execute $sql$
      create policy "base_layouts_select_public"
      on public.base_layouts
      for select
      to anon, authenticated
      using (true)
    $sql$;
  end if;
end $$;

-- Authenticated publish/update/delete policies.
-- If user_id exists, ownership is tied to auth.uid() (text-cast safe for uuid/text).
do $$
declare
  has_user_id boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='base_layouts' and column_name='user_id'
  ) into has_user_id;

  if has_user_id then
    execute $sql$
      create policy "base_layouts_insert_auth"
      on public.base_layouts
      for insert
      to authenticated
      with check (auth.uid() is not null and (user_id is null or user_id::text = auth.uid()::text))
    $sql$;

    execute $sql$
      create policy "base_layouts_update_own"
      on public.base_layouts
      for update
      to authenticated
      using (user_id::text = auth.uid()::text)
      with check (user_id::text = auth.uid()::text)
    $sql$;

    execute $sql$
      create policy "base_layouts_delete_own"
      on public.base_layouts
      for delete
      to authenticated
      using (user_id::text = auth.uid()::text)
    $sql$;
  else
    execute $sql$
      create policy "base_layouts_insert_auth"
      on public.base_layouts
      for insert
      to authenticated
      with check (auth.uid() is not null)
    $sql$;
  end if;
end $$;

grant select on table public.base_layouts to anon, authenticated;
grant insert, update, delete on table public.base_layouts to authenticated;

-- Optional: if visibility column exists and older rows are null, make them visible.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='base_layouts' and column_name='is_public'
  ) then
    execute 'update public.base_layouts set is_public = true where is_public is null';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='base_layouts' and column_name='public'
  ) then
    execute 'update public.base_layouts set public = true where public is null';
  end if;
end $$;

commit;

-- Quick checks:
-- select count(*) as users_count from public.users;
-- select count(*) as base_layouts_count from public.base_layouts;
-- select count(*) as public_layouts_count from public.base_layouts where coalesce(is_public, public, true) = true;
