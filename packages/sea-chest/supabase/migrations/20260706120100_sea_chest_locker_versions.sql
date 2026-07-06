-- Sea Chest phase 1 (Locker_Spec §3): locker_versions -- append-only version history.
-- MIGRATION FILE ONLY: applied by the Captain, never by the marathon crew.
--
-- Version rows are written by the application (SupabaseSeaChestStore.pushItem inserts the
-- new version alongside the item update; the memory store mirrors the behavior 1:1). No
-- trigger on purpose: identical semantics across both store implementations, and the
-- append-only guarantee lives in RLS -- there is NO update and NO delete policy here.

create table if not exists public.locker_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.locker_items (id) on delete cascade,
  version integer not null check (version >= 1),
  content jsonb not null check (jsonb_typeof(content -> 'files') = 'object'),
  created_at timestamptz not null default now(),
  unique (item_id, version)
);

comment on table public.locker_versions is
  'Sea Chest append-only version history per locker item (Locker_Spec §3).';

create index if not exists locker_versions_item_idx
  on public.locker_versions (item_id, version desc);

alter table public.locker_versions enable row level security;

create policy locker_versions_owner_select on public.locker_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.locker_items li
      where li.id = locker_versions.item_id
        and li.user_id = (select auth.uid())
    )
  );

create policy locker_versions_owner_insert on public.locker_versions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.locker_items li
      where li.id = locker_versions.item_id
        and li.user_id = (select auth.uid())
    )
  );

-- Append-only: no update policy, no delete policy.
