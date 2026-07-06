-- LOCAL-CHECK ONLY: exercises the migrations' RLS behavior in the throwaway Postgres
-- (00-shim.sql provides auth.uid()/roles). Every check raises on violation, so a clean
-- exit means: owner isolation, cross-user invisibility, append-only versions, no deletes,
-- published-read projection, and token privacy all hold AS WRITTEN. This is NOT a live
-- Supabase proof -- the Captain re-checks after applying (README checklist).

\set ON_ERROR_STOP on

-- Seed two users (superuser context).
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222')
on conflict do nothing;

---------------------------------------------------------------------------
-- User A creates two items (one to publish later) + a version row + token.
---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
set role authenticated;

insert into public.locker_items (id, user_id, kind, name, content) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'skill', 'demo-skill',
   '{"files": {"SKILL.md": "# demo v1"}}'),
  ('aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'agent', 'private-agent',
   '{"files": {"agents/private.md": "private"}}');

insert into public.locker_versions (item_id, version, content) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 1, '{"files": {"SKILL.md": "# demo v1"}}');

insert into public.marketplace_tokens (user_id, token_hash, label) values
  ('11111111-1111-1111-1111-111111111111', repeat('ab', 32), 'laptop');

insert into public.machine_profiles (user_id, name, item_names) values
  ('11111111-1111-1111-1111-111111111111', 'laptop-default', '["demo-skill"]');

do $$
declare c int;
begin
  select count(*) into c from public.locker_items;
  if c <> 2 then raise exception 'owner should see own 2 items, saw %', c; end if;
end $$;

---------------------------------------------------------------------------
-- User B: A's world must be invisible and unwritable.
---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', false);
set role authenticated;

do $$
declare c int;
begin
  select count(*) into c from public.locker_items;
  if c <> 0 then raise exception 'user B sees % of user A''s items', c; end if;
  select count(*) into c from public.locker_versions;
  if c <> 0 then raise exception 'user B sees % of user A''s versions', c; end if;
  select count(*) into c from public.marketplace_tokens;
  if c <> 0 then raise exception 'user B sees % of user A''s tokens', c; end if;
  select count(*) into c from public.machine_profiles;
  if c <> 0 then raise exception 'user B sees % of user A''s profiles', c; end if;
end $$;

-- Cross-user update matches no rows (RLS filters, no error).
update public.locker_items set description = 'hijacked'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  if exists (
    select 1 from public.locker_items where description = 'hijacked'
  ) then raise exception 'user B updated user A''s item'; end if;
end $$;

-- Cross-user version insert must violate the with-check policy (SQLSTATE 42501).
do $$
begin
  insert into public.locker_versions (item_id, version, content)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 99, '{"files": {"x": "y"}}');
  raise exception 'user B inserted a version into user A''s item';
exception when others then
  if sqlstate <> '42501' then raise; end if;
end $$;

-- Impersonation on insert must also fail (user_id != auth.uid()).
do $$
begin
  insert into public.locker_items (user_id, kind, name, content)
  values ('11111111-1111-1111-1111-111111111111', 'skill', 'forged',
          '{"files": {"SKILL.md": "forged"}}');
  raise exception 'user B inserted an item AS user A';
exception when others then
  if sqlstate <> '42501' then raise; end if;
end $$;

---------------------------------------------------------------------------
-- User A again: append-only + no-delete guarantees.
---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
set role authenticated;

-- Version rows: no update, no delete (policies absent -> zero rows affected).
update public.locker_versions set content = '{"files": {"SKILL.md": "rewritten"}}'
  where version = 1;
delete from public.locker_versions where version = 1;
do $$
declare c int; body text;
begin
  select count(*) into c from public.locker_versions;
  if c <> 1 then raise exception 'version history mutated (count %)', c; end if;
  select content -> 'files' ->> 'SKILL.md' into body from public.locker_versions limit 1;
  if body <> '# demo v1' then raise exception 'version content rewritten to %', body; end if;
end $$;

-- Items: no delete policy.
delete from public.locker_items where name = 'demo-skill';
do $$
declare c int;
begin
  select count(*) into c from public.locker_items;
  if c <> 2 then raise exception 'owner delete slipped through RLS (count %)', c; end if;
end $$;

-- Publish one item.
update public.locker_items set published = true where name = 'demo-skill';

---------------------------------------------------------------------------
-- Anonymous: sees ONLY published metadata; tokens stay dark.
---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;

do $$
declare c int;
begin
  select count(*) into c from public.locker_items;
  if c <> 1 then raise exception 'anon sees % items (want 1 published)', c; end if;
  select count(*) into c from public.published_items;
  if c <> 1 then raise exception 'published_items view returned % rows', c; end if;
  select count(*) into c from public.published_items where name = 'private-agent';
  if c <> 0 then raise exception 'unpublished item leaked into published_items'; end if;
  select count(*) into c from public.marketplace_tokens;
  if c <> 0 then raise exception 'anon can read marketplace tokens'; end if;
end $$;

---------------------------------------------------------------------------
-- service_role (marketplace request path): bypasses RLS by design.
---------------------------------------------------------------------------
reset role;
set role service_role;

do $$
declare c int;
begin
  select count(*) into c from public.marketplace_tokens;
  if c <> 1 then raise exception 'service_role should resolve tokens, saw %', c; end if;
end $$;

reset role;
select 'RLS CHECKS PASSED' as result;
