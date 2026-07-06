-- LOCAL-CHECK SHIM (never a migration): recreates just enough of the Supabase runtime in a
-- vanilla throwaway Postgres so the migration files load and their RLS can be exercised
-- locally without touching any live project. Used only by run-local-check.mjs.

create schema if not exists auth;

-- Supabase's auth.users, reduced to the column our FKs reference.
create table if not exists auth.users (
  id uuid primary key
);

-- Supabase resolves auth.uid() from the request JWT; PostgREST surfaces it as the
-- request.jwt.claims GUC -- same mechanism here.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
