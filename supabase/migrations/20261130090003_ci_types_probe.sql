-- PROBE for werk-flow/werkflow-app#362, removed in the next commit: CI's SQL job must upload the types it generates.
create function public.ci_types_probe() returns integer
language sql stable set search_path = '' as $$ select 1 $$;
revoke all on function public.ci_types_probe() from public, anon, authenticated;
