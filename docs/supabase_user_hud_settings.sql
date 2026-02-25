-- Run this in Supabase SQL Editor
-- Stores per-user HUD/keybind/custom-visual preferences.

create table if not exists public.user_hud_settings (
  user_id text primary key,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_hud_settings_updated_at
  on public.user_hud_settings (updated_at desc);

alter table public.user_hud_settings enable row level security;

-- If your app uses auth.uid() mapped directly to users.id (uuid/text), this works.
-- If your users.id uses Discord IDs or another external ID, adjust policies accordingly.
drop policy if exists "user_hud_settings_select_own" on public.user_hud_settings;
create policy "user_hud_settings_select_own"
on public.user_hud_settings
for select
using (auth.uid()::text = user_id);

drop policy if exists "user_hud_settings_upsert_own" on public.user_hud_settings;
create policy "user_hud_settings_upsert_own"
on public.user_hud_settings
for insert
with check (auth.uid()::text = user_id);

drop policy if exists "user_hud_settings_update_own" on public.user_hud_settings;
create policy "user_hud_settings_update_own"
on public.user_hud_settings
for update
using (auth.uid()::text = user_id)
with check (auth.uid()::text = user_id);

-- Optional: service-role access is unaffected by RLS (bypasses policies).
