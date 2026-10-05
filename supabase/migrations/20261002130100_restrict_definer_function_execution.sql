-- Restrict execution of SECURITY DEFINER functions in public and app_private
-- (docs/technical/security.md, rule 3). The reviewed inventory of what
-- authenticated may still execute, with a reason per function, lives in
-- supabase/tests/security_boundaries.sql.

-- Trigger functions run when their trigger fires; PostgreSQL checks EXECUTE
-- only when a trigger is created. No client role needs to call one.
do $$
declare target regprocedure;
begin
  for target in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private') and p.prosecdef
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', target);
  end loop;
end;
$$;

-- RLS helpers that still allowed execution through PUBLIC or anon. Policies
-- evaluate them as the querying role, so authenticated keeps EXECUTE.
revoke all on function app_private.get_user_org_ids(uuid) from public, anon;
revoke all on function app_private.get_user_admin_or_manager_org_ids(uuid) from public, anon;
revoke all on function app_private.get_user_employee_record_ids(uuid) from public, anon;
revoke all on function app_private.can_access_job_inventory(uuid, uuid) from public, anon;
revoke all on function app_private.is_document_manager(uuid, uuid) from public, anon;
revoke all on function app_private.is_inventory_manager(uuid, uuid) from public, anon;
grant execute on function app_private.get_user_employee_record_ids(uuid) to authenticated, service_role;
grant execute on function app_private.can_access_job_inventory(uuid, uuid) to authenticated, service_role;
grant execute on function app_private.is_document_manager(uuid, uuid) to authenticated, service_role;
grant execute on function app_private.is_inventory_manager(uuid, uuid) to authenticated, service_role;

-- Internal steps that only other SECURITY DEFINER functions call, running as
-- their owner. No policy and no client caller needs them.
revoke all on function app_private.seed_inventory_defaults(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.sync_planning_dispatch_for_occurrence(uuid) from public, anon, authenticated;
revoke all on function app_private.work_handover_actor_can_review(uuid, uuid) from public, anon, authenticated;

-- No policy, no function and no app code calls this helper.
revoke all on function app_private.p1_24_current_user_is_admin(uuid) from public, anon, authenticated;

-- The app reads members and redeems invites through the public service-role
-- RPCs on the admin client (lib/members/queries.ts, lib/jobs/actions.ts,
-- app/auth/callback/route.ts, app/api/redeem-invite/route.ts). The unused
-- invoker wrappers public.get_org_members(uuid) and
-- public.redeem_organization_invite(text) were the only authenticated path
-- into these, and it skipped the server routes that own invite redemption.
revoke all on function app_private.get_org_members_for_user(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.redeem_organization_invite_for_user(text, uuid) from public, anon, authenticated;

-- No SECURITY DEFINER function in these schemas is executable by anon.
do $$
declare target regprocedure;
begin
  for target in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private') and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke all on function %s from public, anon', target);
  end loop;
end;
$$;
