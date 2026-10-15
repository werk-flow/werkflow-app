-- Client roles write no public table directly. Server code writes through the
-- admin client and the service-only functions; the one client write, a user's
-- own name and avatar, gets its column grant in migration 20261015100200.
-- The historical grants (migration 20260928154200) gave authenticated INSERT,
-- UPDATE and DELETE on tables whose only policy is SELECT, and on tables
-- whose write policies no code path uses. RLS denied those rows; the grants
-- still exceeded what the app needs, so every one goes.
-- supabase/tests/security_boundaries.sql keeps client writes a closed inventory.
do $$
declare
  relation regclass;
begin
  for relation in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke insert, update, delete on table %s from authenticated', relation);
  end loop;
end;
$$;

-- New functions in public were executable by every client role through the
-- built-in PUBLIC default and the schema default for anon and authenticated.
-- Each migration revoked them by hand; from now on a function is closed
-- until its migration grants it.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
