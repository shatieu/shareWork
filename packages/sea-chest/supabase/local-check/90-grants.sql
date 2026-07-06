-- LOCAL-CHECK ONLY: Supabase projects grant table privileges to anon/authenticated/
-- service_role via default privileges; vanilla Postgres has none of that, so grant here
-- (RLS still gates every row -- that's exactly what the checks exercise).

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
grant select on public.published_items to anon, authenticated, service_role;
