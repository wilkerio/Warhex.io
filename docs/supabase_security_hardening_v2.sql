-- Run in Supabase SQL Editor.
-- WARHEX security hardening (RLS + anti-escalation + safe public leaderboard RPC).
--
-- What this does:
-- 1) Locks public.users to "owner-only" access for authenticated users.
-- 2) Blocks client-side role/email tampering in public.users (except service_role).
-- 3) Restricts user_skins and base_layouts writes to the authenticated owner.
-- 4) Exposes only safe leaderboard fields via public.get_public_leaderboard(p_limit).

begin;

-- ============================================================
-- Helpers
-- ============================================================

create or replace function public.warhex_request_jwt_role()
returns text
language plpgsql
stable
as $$
declare
  claims_raw text;
  role_text text;
begin
  role_text := nullif(current_setting('request.jwt.claim.role', true), '');
  if role_text is not null then
    return lower(role_text);
  end if;

  claims_raw := nullif(current_setting('request.jwt.claims', true), '');
  if claims_raw is null then
    return '';
  end if;

  begin
    role_text := nullif((claims_raw::jsonb ->> 'role'), '');
  exception when others then
    role_text := null;
  end;

  return lower(coalesce(role_text, ''));
end;
$$;

create or replace function public.warhex_is_service_role()
returns boolean
language sql
stable
as $$
  select public.warhex_request_jwt_role() = 'service_role';
$$;

create or replace function public.warhex_parse_nonneg_bigint(value_text text)
returns bigint
language plpgsql
immutable
as $$
declare
  parsed numeric;
begin
  if value_text is null or btrim(value_text) = '' then
    return null;
  end if;

  begin
    parsed := value_text::numeric;
  exception when others then
    return null;
  end;

  if parsed < 0 then
    return 0;
  end if;

  return floor(parsed)::bigint;
end;
$$;

-- ============================================================
-- users: RLS + anti-escalation trigger
-- ============================================================

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'public.users not found. Skipping users hardening.';
    return;
  end if;

  execute 'alter table public.users enable row level security';
  execute 'revoke all on table public.users from anon';
  execute 'grant select, insert, update on table public.users to authenticated';

  execute 'drop policy if exists "users_select_leaderboard_public" on public.users';
  execute 'drop policy if exists "users_select_own" on public.users';
  execute 'drop policy if exists "users_insert_own" on public.users';
  execute 'drop policy if exists "users_update_own" on public.users';

  execute $sql$
    create policy "users_select_own"
    on public.users
    for select
    to authenticated
    using (auth.uid() is not null and id::text = auth.uid()::text)
  $sql$;

  execute $sql$
    create policy "users_insert_own"
    on public.users
    for insert
    to authenticated
    with check (auth.uid() is not null and id::text = auth.uid()::text)
  $sql$;

  execute $sql$
    create policy "users_update_own"
    on public.users
    for update
    to authenticated
    using (auth.uid() is not null and id::text = auth.uid()::text)
    with check (auth.uid() is not null and id::text = auth.uid()::text)
  $sql$;
end $$;

create or replace function public.users_block_sensitive_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_role text;
  old_role text;
  new_email text;
  old_email text;
begin
  -- service_role keeps full power (server-side trusted jobs).
  if public.warhex_is_service_role() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(to_jsonb(new)->>'id', '') <> coalesce(to_jsonb(old)->>'id', '') then
      raise exception 'users.id is immutable';
    end if;
  end if;

  new_role := lower(coalesce(to_jsonb(new)->>'role', ''));
  old_role := lower(coalesce(to_jsonb(old)->>'role', ''));

  if tg_op = 'INSERT' then
    if new_role in ('owner', 'admin', 'adm', 'dono', 'service_role') then
      raise exception 'cannot create privileged role from client request';
    end if;
  elsif tg_op = 'UPDATE' then
    if new_role <> old_role then
      raise exception 'users.role cannot be changed from client request';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new_email := lower(coalesce(to_jsonb(new)->>'email', ''));
    old_email := lower(coalesce(to_jsonb(old)->>'email', ''));
    if old_email <> '' and new_email <> old_email then
      raise exception 'users.email is immutable';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.users') is null then
    return;
  end if;

  execute 'drop trigger if exists users_block_sensitive_mutation on public.users';
  execute 'create trigger users_block_sensitive_mutation before insert or update on public.users for each row execute function public.users_block_sensitive_mutation()';
end $$;

-- ============================================================
-- user_skins: owner-only RLS
-- ============================================================

do $$
declare
  has_user_id boolean;
begin
  if to_regclass('public.user_skins') is null then
    raise notice 'public.user_skins not found. Skipping user_skins hardening.';
    return;
  end if;

  execute 'alter table public.user_skins enable row level security';
  execute 'revoke all on table public.user_skins from anon';
  execute 'grant select, insert, update, delete on table public.user_skins to authenticated';

  execute 'drop policy if exists "user_skins_select_own" on public.user_skins';
  execute 'drop policy if exists "user_skins_insert_own" on public.user_skins';
  execute 'drop policy if exists "user_skins_update_own" on public.user_skins';
  execute 'drop policy if exists "user_skins_delete_own" on public.user_skins';

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_skins'
      and column_name = 'user_id'
  ) into has_user_id;

  if has_user_id then
    execute $sql$
      create policy "user_skins_select_own"
      on public.user_skins
      for select
      to authenticated
      using (auth.uid()::text = user_id::text)
    $sql$;

    execute $sql$
      create policy "user_skins_insert_own"
      on public.user_skins
      for insert
      to authenticated
      with check (auth.uid()::text = user_id::text)
    $sql$;

    execute $sql$
      create policy "user_skins_update_own"
      on public.user_skins
      for update
      to authenticated
      using (auth.uid()::text = user_id::text)
      with check (auth.uid()::text = user_id::text)
    $sql$;

    execute $sql$
      create policy "user_skins_delete_own"
      on public.user_skins
      for delete
      to authenticated
      using (auth.uid()::text = user_id::text)
    $sql$;
  end if;
end $$;

-- ============================================================
-- base_layouts: public-read + owner-write
-- ============================================================

do $$
declare
  has_is_public boolean;
  has_public boolean;
  has_user_id boolean;
begin
  if to_regclass('public.base_layouts') is null then
    raise notice 'public.base_layouts not found. Skipping base_layouts hardening.';
    return;
  end if;

  execute 'alter table public.base_layouts enable row level security';
  execute 'revoke all on table public.base_layouts from anon';
  execute 'grant select on table public.base_layouts to anon, authenticated';
  execute 'grant insert, update, delete on table public.base_layouts to authenticated';

  execute 'drop policy if exists "base_layouts_select_public" on public.base_layouts';
  execute 'drop policy if exists "base_layouts_insert_auth" on public.base_layouts';
  execute 'drop policy if exists "base_layouts_update_own" on public.base_layouts';
  execute 'drop policy if exists "base_layouts_delete_own" on public.base_layouts';

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
      with check (auth.uid() is not null and user_id::text = auth.uid()::text)
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

-- ============================================================
-- Safe public leaderboard RPC (no email/role leakage)
-- ============================================================

do $$
begin
  if to_regclass('public.users') is null then
    raise notice 'public.users not found. Skipping get_public_leaderboard RPC.';
    return;
  end if;

  execute $fn$
    create or replace function public.get_public_leaderboard(p_limit integer default 10)
    returns table (
      name text,
      highscore bigint,
      playtime bigint,
      kills bigint
    )
    language sql
    stable
    security definer
    set search_path = public
    as $$
      with normalized as (
        select
          coalesce(
            nullif(trim(both from coalesce(
              to_jsonb(u)->>'nickname',
              to_jsonb(u)->>'username',
              to_jsonb(u)->>'display_name',
              to_jsonb(u)->>'name',
              to_jsonb(u)->>'discord_username'
            )), ''),
            'Player'
          ) as name,
          coalesce(
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->>'highscore'),
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->'statistics'->>'highscore'),
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->'statistics'->>'score'),
            0
          ) as highscore,
          coalesce(
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->>'playtime'),
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->'statistics'->>'playtime'),
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->'statistics'->>'time_played'),
            0
          ) as playtime,
          coalesce(
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->>'total_kills'),
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->'statistics'->>'kills'),
            public.warhex_parse_nonneg_bigint(to_jsonb(u)->'statistics'->>'total_kills'),
            0
          ) as kills
        from public.users u
      )
      select n.name, n.highscore, n.playtime, n.kills
      from normalized n
      order by n.highscore desc, n.kills desc, n.playtime desc
      limit greatest(1, least(coalesce(p_limit, 10), 200));
    $$;
  $fn$;

  execute 'revoke all on function public.get_public_leaderboard(integer) from public';
  execute 'grant execute on function public.get_public_leaderboard(integer) to anon, authenticated';
end $$;

commit;

-- ============================================================
-- Quick smoke tests (run manually after applying script)
-- ============================================================
-- 1) Anonymous cannot read users directly:
--    GET /rest/v1/users?select=email,role&limit=1   -> should be 401/403
--
-- 2) Public leaderboard works:
--    POST /rest/v1/rpc/get_public_leaderboard {"p_limit":10} -> should return rows without email/role
--
-- 3) Authenticated user cannot escalate role:
--    PATCH /rest/v1/users?id=eq.<auth.uid> {"role":"owner"} -> should fail
