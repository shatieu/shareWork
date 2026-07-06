-- Sea Chest phase 2 (Locker_Spec §2.1): marketplace_tokens -- auth for the private
-- marketplace endpoint. Only the sha-256 HASH of a token is stored; the plaintext is shown
-- exactly once at mint time (UI/API) and never touches the database.
-- MIGRATION FILE ONLY: applied by the Captain, never by the marathon crew.

create table if not exists public.marketplace_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.marketplace_tokens is
  'Sea Chest marketplace tokens (Locker_Spec §2.1): sha-256 hashes only, revocable.';

create index if not exists marketplace_tokens_user_idx
  on public.marketplace_tokens (user_id);

alter table public.marketplace_tokens enable row level security;

-- Owners manage their own tokens from the locker page (mint = insert, revoke = update of
-- revoked_at; no delete -- revocation stays auditable).
create policy marketplace_tokens_owner_select on public.marketplace_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy marketplace_tokens_owner_insert on public.marketplace_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy marketplace_tokens_owner_update on public.marketplace_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The marketplace request path (handleMarketplaceRequest -> resolveToken) has NO Supabase
-- session -- Harbor constructs SupabaseSeaChestStore with a SERVICE-ROLE client there (RLS
-- bypass), and every query in that code path is explicitly user_id-scoped in code. There is
-- deliberately no anon policy on this table.
