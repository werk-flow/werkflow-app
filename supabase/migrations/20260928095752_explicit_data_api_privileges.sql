-- Client roles never manage table structure or bypass row policies through TRUNCATE.
-- Preserve current row-operation grants and RLS; this changes no business permission.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Match Supabase's announced new-table behavior before Wave 3 adds more tables.
-- New public tables/sequences created by our migration role need explicit grants.
-- Existing object grants are unaffected; function defaults remain separately governed.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
