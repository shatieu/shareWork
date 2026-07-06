-- Sea Chest phase 1 (Locker_Spec §3): locker_items -- the locker's item store.
-- MIGRATION FILE ONLY: never applied by the marathon crew; the Captain applies it to the
-- platform Supabase project (see packages/sea-chest/README.md, "Apply the migrations").
--
-- Items are server-readable by design (spec §1: "config items server-readable (RLS-isolated
-- per user/team) -> enables web UI, marketplace serving, search, sharing"). Secrets NEVER
-- live here (phase-2 vault; v1 uses ${locker:...} refs resolved client-side).

create table if not exists public.locker_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid,
  kind text not null check (
    kind in (
      'skill', 'agent', 'hook', 'settings_template',
      'claude_md', 'mcp_config', 'preset', 'plugin_bundle'
    )
  ),
  name text not null check (
    name ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' and char_length(name) <= 128
  ),
  description text not null default '',
  -- Plugin-shaped bundle: {"files": {"<relative path>": "<text>", ...}, "meta": {...}}
  content jsonb not null check (jsonb_typeof(content -> 'files') = 'object'),
  version integer not null default 1 check (version >= 1),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Item names are the stable identity within one user's locker (re-push bumps version).
  unique (user_id, name)
);

comment on table public.locker_items is
  'Sea Chest locker items (Locker_Spec §3): plugin-shaped bundles per user.';

create index if not exists locker_items_user_kind_idx
  on public.locker_items (user_id, kind);

alter table public.locker_items enable row level security;

-- Owner: full read/write of own rows. (auth.uid() wrapped in a scalar subquery so the
-- planner evaluates it once -- Supabase RLS performance guidance.)
create policy locker_items_owner_select on public.locker_items
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy locker_items_owner_insert on public.locker_items
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy locker_items_owner_update on public.locker_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- NO delete policy in v1: the locker is append-and-evolve; takedown/moderation arrives with
-- publishing (phase 5) as an explicit, audited path.

-- Published items are publicly readable (spec §3 published_items projection; phase 5 serves
-- them on the community marketplace -- the RLS gate ships now so RLS is complete on day one).
create policy locker_items_published_read on public.locker_items
  for select to anon, authenticated
  using (published = true);

-- Public projection of published items (metadata only -- content is served through the
-- marketplace/community endpoints, not raw). security_invoker: the policies above gate it.
create or replace view public.published_items
  with (security_invoker = on) as
  select id, kind, name, description, version, created_at, updated_at
  from public.locker_items
  where published = true;

comment on view public.published_items is
  'Sea Chest community projection (Locker_Spec §3): published locker items, metadata only.';
