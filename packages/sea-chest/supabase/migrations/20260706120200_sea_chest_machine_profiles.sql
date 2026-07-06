-- Sea Chest phase 3 (Locker_Spec §5): machine_profiles -- named item sets for
-- locker_setup_machine ("laptop-default", "work-vm").
-- MIGRATION FILE ONLY: applied by the Captain, never by the marathon crew.

create table if not exists public.machine_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 128),
  -- JSON array of locker item names; resolved at setup time (missing names are reported
  -- in the setup manifest, never silently dropped).
  item_names jsonb not null default '[]'::jsonb check (jsonb_typeof(item_names) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

comment on table public.machine_profiles is
  'Sea Chest machine profiles (Locker_Spec §5): named item sets for locker_setup_machine.';

alter table public.machine_profiles enable row level security;

create policy machine_profiles_owner_all on public.machine_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
