-- Run this in Supabase SQL Editor.
-- Goal: recreate missing rows in public.users from auth.users after accidental deletes.
-- Safe behavior: only inserts users that do not exist in public.users yet.

do $$
declare
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  sql_insert text;
  inserted_count integer := 0;
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) then
    raise exception 'Table public.users not found.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'id'
  ) then
    raise exception 'Column public.users.id not found.';
  end if;

  -- Required identity column.
  cols := array_append(cols, 'id');
  vals := array_append(vals, 'au.id');

  -- Common optional columns (only included when present in your schema).
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='email') then
    cols := array_append(cols, 'email');
    vals := array_append(vals, 'coalesce(nullif(au.email, ''''), au.id::text || ''@oauth.local'')');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='nickname') then
    cols := array_append(cols, 'nickname');
    vals := array_append(vals, 'left(regexp_replace(coalesce(au.raw_user_meta_data->>''nickname'', au.raw_user_meta_data->>''preferred_username'', split_part(coalesce(au.email, au.id::text || ''@oauth.local''), ''@'', 1), ''Player''), ''[^a-zA-Z0-9_]+'', ''_'', ''g''), 20)');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='username') then
    cols := array_append(cols, 'username');
    vals := array_append(vals, 'left(regexp_replace(coalesce(au.raw_user_meta_data->>''nickname'', split_part(coalesce(au.email, au.id::text || ''@oauth.local''), ''@'', 1), ''Player''), ''[^a-zA-Z0-9_]+'', ''_'', ''g'') || ''_'' || left(replace(au.id::text, ''-'', ''''), 6), 20)');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='highscore') then
    cols := array_append(cols, 'highscore');
    vals := array_append(vals, '0');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='total_kills') then
    cols := array_append(cols, 'total_kills');
    vals := array_append(vals, '0');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='playtime') then
    cols := array_append(cols, 'playtime');
    vals := array_append(vals, '0');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='level') then
    cols := array_append(cols, 'level');
    vals := array_append(vals, '1');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='xp') then
    cols := array_append(cols, 'xp');
    vals := array_append(vals, '0');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='coins') then
    cols := array_append(cols, 'coins');
    vals := array_append(vals, '0');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='selected_skin') then
    cols := array_append(cols, 'selected_skin');
    vals := array_append(vals, '0');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='progression') then
    cols := array_append(cols, 'progression');
    vals := array_append(vals, 'jsonb_build_object(''level'', 1, ''xp'', 0)');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='statistics') then
    cols := array_append(cols, 'statistics');
    vals := array_append(vals, 'jsonb_build_object(''highscore'', 0, ''kills'', 0, ''playtime'', 0)');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='skins') then
    cols := array_append(cols, 'skins');
    vals := array_append(vals, 'jsonb_build_object(''equipped'', 0, ''unlocked'', jsonb_build_array(0))');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='created_at') then
    cols := array_append(cols, 'created_at');
    vals := array_append(vals, 'now()');
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='updated_at') then
    cols := array_append(cols, 'updated_at');
    vals := array_append(vals, 'now()');
  end if;

  sql_insert := format(
    'insert into public.users (%s)
     select %s
     from auth.users au
     where not exists (
       select 1 from public.users pu where pu.id = au.id
     )',
    array_to_string(cols, ', '),
    array_to_string(vals, ', ')
  );

  execute sql_insert;
  get diagnostics inserted_count = row_count;
  raise notice 'Recovered % missing users into public.users.', inserted_count;
end $$;

