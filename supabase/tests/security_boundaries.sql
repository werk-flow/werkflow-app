-- Security boundary assertions (docs/technical/security.md owns the rules).
-- Runs inside one transaction against the local stack and rolls back.
-- Each block raises on violation; ON_ERROR_STOP turns that into a failed group.
begin;

-- Future tables cannot silently inherit Data API access. The service role still
-- needs explicit SELECT on every operational table; RLS bypass is not a grant.
do $$
declare offender text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into offender
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and (not c.relrowsecurity or not has_table_privilege('service_role', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER'));
  if offender is not null then
    raise exception 'Public table RLS/service grant/client structural privilege violation: %', offender;
  end if;
end;
$$;

-- Every public table belongs to an organization through its organization_id
-- column, which the RLS policies and lib/conventions/tenant-scope.test.ts key
-- on. A table that is not organization-owned joins this list with the reason
-- its rows belong to no organization; a listed table that gains the column or
-- no longer exists fails until the list shrinks.
do $$
declare
  global_tables constant text[] := array[
    'email_change_challenges',    -- one row per Auth account; the change is account-wide.
    'organization_join_attempts', -- failed join attempts of a user before any membership exists.
    'organizations',              -- the tenant itself; its id is the organization key.
    'profiles',                   -- one row per Auth account; a person can belong to several organizations.
    'rate_limit_attempts',        -- keyed subject hashes; a limit can apply before an organization is known.
    'subscriptions'               -- billing per paying account (user_id); closes with the payment slice.
  ];
  offender text; stale text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into offender
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and c.relname <> all (global_tables)
    and not exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
    );
  if offender is not null then
    raise exception 'Public table without organization_id and not in the reviewed global-table list: %', offender;
  end if;
  select string_agg(name, ', ' order by name) into stale
  from unnest(global_tables) as name
  where to_regclass('public.' || quote_ident(name)) is null
    or exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.' || quote_ident(name))
        and a.attname = 'organization_id' and not a.attisdropped
    );
  if stale is not null then
    raise exception 'Global-table list names a missing or organization-owned table: %', stale;
  end if;
end;
$$;

-- Anonymous row privileges are a closed, reviewed inventory
-- (docs/technical/security.md, "Trust boundaries", Database). The signed-out
-- app reads and writes no public table with the anon role, so the inventory is
-- empty (migration 20261002130000_revoke_anonymous_table_grants.sql). A table
-- granted to anon, or a column-level grant, fails here until the owner
-- approves it and this list gains the table with a comment naming its caller.
do $$
declare
  reviewed constant text[] := array[]::text[];
  unreviewed text; missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into unreviewed
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE'))
    and c.relname <> all (reviewed);
  if unreviewed is not null then
    raise exception 'Unreviewed anonymous row privilege on: %', unreviewed;
  end if;
  select string_agg(name, ', ' order by name) into missing
  from unnest(reviewed) as name
  where to_regclass('public.' || quote_ident(name)) is null
    or not has_table_privilege('anon', to_regclass('public.' || quote_ident(name)), 'SELECT,INSERT,UPDATE,DELETE');
  if missing is not null then
    raise exception 'Anonymous privilege inventory lists tables without the grant: %', missing;
  end if;
  select string_agg(c.relname, ', ' order by c.relname) into unreviewed
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    -- The planner may test the privilege before the kind; guard it explicitly.
    and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') else false end;
  if unreviewed is not null then
    raise exception 'Anonymous sequence privilege on: %', unreviewed;
  end if;
end;
$$;

-- RLS without a policy denies every client row, so such a table must be
-- service-only by grant as well; a table a client role can address needs at
-- least one policy that states who sees what.
do $$
declare offender text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into offender
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE')
      or has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE'));
  if offender is not null then
    raise exception 'Public table without an RLS policy is reachable by a client role: %', offender;
  end if;
end;
$$;

-- Foundational access must survive a replay without legacy defaults: the
-- server writes through the service role, a signed-in user only reads, and
-- RLS still owns which records the user sees.
do $$
declare relation_name text; operation_name text;
begin
  foreach relation_name in array array['organizations', 'organization_members', 'profiles', 'clients', 'jobs'] loop
    foreach operation_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', 'public.' || relation_name, operation_name) then
        raise exception 'Missing explicit foundation privilege: service_role % %', relation_name, operation_name;
      end if;
    end loop;
    if not has_table_privilege('authenticated', 'public.' || relation_name, 'SELECT') then
      raise exception 'Missing explicit foundation privilege: authenticated % SELECT', relation_name;
    end if;
  end loop;
end;
$$;

-- A client grant exists only together with the policy that limits it: for
-- every public table and command, a table or column privilege of anon or
-- authenticated needs a permissive policy for that command that applies to
-- the role. The check is a temporary function so that the probe below runs
-- the same query against a table that violates it.
create function pg_temp.client_grants_without_policy() returns text language sql as $$
  select string_agg(c.relname || ' ' || grantee.role || ' ' || command.name, ', '
    order by c.relname, grantee.role, command.name)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as grantee(role)
  cross join (values ('SELECT', 'r'), ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')) as command(name, code)
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and (has_table_privilege(grantee.role, c.oid, command.name)
      or (command.name <> 'DELETE' and has_any_column_privilege(grantee.role, c.oid, command.name)))
    and not exists (
      select 1 from pg_policy p
      where p.polrelid = c.oid and p.polpermissive
        and p.polcmd in ('*', command.code)
        and (0::oid = any (p.polroles) or grantee.role::regrole::oid = any (p.polroles))
    );
$$;

do $$
declare offender text := pg_temp.client_grants_without_policy();
begin
  if offender is not null then
    raise exception 'Client grant without a matching policy: %', offender;
  end if;
end;
$$;

-- Probe: a table with only a SELECT policy and an INSERT grant must be reported.
create table public.werkflow_policy_probe (id bigint primary key);
alter table public.werkflow_policy_probe enable row level security;
create policy "probe reads" on public.werkflow_policy_probe for select to authenticated using (true);
grant select, insert on table public.werkflow_policy_probe to authenticated;
do $$
begin
  if coalesce(pg_temp.client_grants_without_policy(), '') <> 'werkflow_policy_probe authenticated INSERT' then
    raise exception 'Grant-without-policy check missed the probe: %', pg_temp.client_grants_without_policy();
  end if;
end;
$$;
drop table public.werkflow_policy_probe;

-- The reverse: a permissive write policy for a command that no client role
-- holds a grant for never applies. It reads like a permission a reviewer must
-- check, and a later grant would bring it back to life unreviewed (migration
-- 20261022100000). A deny-everything policy (`false`) documents the denial
-- and stays allowed.
create function pg_temp.write_policies_without_grant() returns text language sql as $$
  select string_agg(c.relname || ' ' || p.polname, ', ' order by c.relname, p.polname)
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and p.polpermissive and p.polcmd <> 'r'
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '') <> 'false'
    and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') <> 'false'
    and not exists (
      select 1
      from (values ('anon'), ('authenticated')) as grantee(role),
        (values ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')) as command(name, code)
      where p.polcmd in ('*', command.code)
        and (has_table_privilege(grantee.role, c.oid, command.name)
          or (command.name <> 'DELETE' and has_any_column_privilege(grantee.role, c.oid, command.name)))
    );
$$;

do $$
declare offender text := pg_temp.write_policies_without_grant();
begin
  if offender is not null then
    raise exception 'Write policy without a client grant: %', offender;
  end if;
end;
$$;

-- Probe: a write policy on a table without a client write grant must be reported.
create table public.werkflow_inert_policy_probe (id bigint primary key);
alter table public.werkflow_inert_policy_probe enable row level security;
create policy "probe writes" on public.werkflow_inert_policy_probe for insert to authenticated with check (true);
do $$
begin
  if coalesce(pg_temp.write_policies_without_grant(), '') <> 'werkflow_inert_policy_probe probe writes' then
    raise exception 'Write-policy-without-grant check missed the probe: %', pg_temp.write_policies_without_grant();
  end if;
end;
$$;
drop table public.werkflow_inert_policy_probe;

-- RLS consults effective personnel access, not only the membership, the
-- assignment or the employee record link: suspension and access end keep all
-- three (docs/technical/security.md, "Revocation boundaries"). Every public
-- policy, every app_private helper that authenticated executes or a policy
-- calls, and every helper those call in turn, that reads organization_members,
-- job_assignments or employee_records also calls an effective-access helper.
-- The check reads function bodies as text: a body that calls the helper in one
-- branch and reads membership in another passes, so review still owns each
-- branch, and client_read_boundaries.sql drives suspended members per table
-- family. The two exemptions compute access themselves.
create function pg_temp.reads_without_effective_access() returns text language sql as $$
  with recursive policy as (
    select c.relname || ' policy "' || p.polname || '"' as name,
      coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' '
        || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as body
    from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace
  ), helper as (
    select p.oid, p.proname, p.prosrc from pg_proc p
    where p.pronamespace = 'app_private'::regnamespace
  ), reached (oid) as (
    select helper.oid from helper
    where has_function_privilege('authenticated', helper.oid, 'EXECUTE')
      or exists (
        select 1 from policy where policy.body ~ ('\mapp_private\.' || helper.proname || '\(')
      )
    union
    select callee.oid from reached
    join helper caller on caller.oid = reached.oid
    join helper callee on caller.prosrc ~ ('\mapp_private\.' || callee.proname || '\(')
  ), checked as (
    select 'app_private.' || helper.proname as name, helper.prosrc as body
    from helper join reached on reached.oid = helper.oid
    union all
    select policy.name, policy.body from policy
  )
  select string_agg(distinct checked.name, ', ' order by checked.name) from checked
  where checked.body ~ '\m(organization_members|job_assignments|employee_records)\M'
    and checked.body !~ ('\mapp_private\.(p1_24_has_effective_access|p1_24_is_manager|p1_24_is_admin'
      || '|p1_24_is_self|get_user_org_ids|get_user_admin_or_manager_org_ids'
      || '|get_user_employee_record_ids|get_user_assigned_job_ids|get_user_assigned_project_ids)\(')
    and checked.name not in (
      -- the effective-access state itself
      'app_private.p1_24_effective_access_state',
      -- the prestart state, which a policy grants only through p1_24_is_self
      'app_private.p1_24_has_prestart_access'
    );
$$;

do $$
declare offender text := pg_temp.reads_without_effective_access();
begin
  if offender is not null then
    raise exception 'RLS reads membership, assignment or employee link without effective access: %', offender;
  end if;
end;
$$;

-- Probe: a policy and a helper that read membership directly must be reported.
create table public.werkflow_access_probe (id bigint primary key, organization_id uuid);
alter table public.werkflow_access_probe enable row level security;
create function app_private.werkflow_access_probe(p_organization_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = (select auth.uid())
  );
$$;
create policy "probe reads" on public.werkflow_access_probe for select to authenticated
  using (app_private.werkflow_access_probe(organization_id) or exists (
    select 1 from public.job_assignments assignment where assignment.user_id = (select auth.uid())
  ));
do $$
begin
  if coalesce(pg_temp.reads_without_effective_access(), '')
     <> 'app_private.werkflow_access_probe, werkflow_access_probe policy "probe reads"' then
    raise exception 'Effective-access check missed the probe: %', pg_temp.reads_without_effective_access();
  end if;
end;
$$;
drop table public.werkflow_access_probe;
drop function app_private.werkflow_access_probe(uuid);

-- Client roles write no public table directly (migration 20261015100100).
-- Every client write privilege is in this reviewed inventory with its caller;
-- a new one fails until it is listed, and a listed one that disappears fails
-- until the list shrinks.
do $$
declare
  reviewed constant text[] := array[
    -- updateProfileSettings and the avatar actions in lib/settings/actions.ts (own row only)
    'profiles.avatar_path UPDATE',
    'profiles.first_name UPDATE',
    'profiles.last_name UPDATE',
    'profiles.updated_at UPDATE'
  ];
  unreviewed text; missing text;
begin
  select string_agg(c.relname || ' ' || command.name, ', ' order by c.relname, command.name) into unreviewed
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as command(name)
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('authenticated', c.oid, command.name)
      or has_table_privilege('anon', c.oid, command.name));
  if unreviewed is not null then
    raise exception 'Table-level client write privilege on: %', unreviewed;
  end if;

  with granted as (
    select privilege.table_name || '.' || privilege.column_name || ' ' || privilege.privilege_type as entry
    from information_schema.column_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege.privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')
  )
  select string_agg(entry, ', ' order by entry) into unreviewed
  from granted where entry <> all (reviewed);
  if unreviewed is not null then
    raise exception 'Unreviewed client column write privilege: %', unreviewed;
  end if;

  select string_agg(entry, ', ' order by entry) into missing
  from unnest(reviewed) as entry
  where not has_column_privilege('authenticated', 'public.' || split_part(split_part(entry, ' ', 1), '.', 1),
    split_part(split_part(entry, ' ', 1), '.', 2), split_part(entry, ' ', 2));
  if missing is not null then
    raise exception 'Client write inventory lists missing privileges: %', missing;
  end if;
end;
$$;

-- No function in the exposed schema is executable by a client role unless
-- reviewed here: PostgREST would serve it as an RPC. The definer functions
-- have their own inventory below, and today no invoker function is listed
-- either. Migration 20261015100100 closed the creation default, and the
-- probe proves that a new function inherits no client execution.
do $$
declare
  reviewed constant text[] := array[]::text[];
  unreviewed text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into unreviewed
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not p.prosecdef
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    and p.oid::regprocedure::text <> all (reviewed);
  if unreviewed is not null then
    raise exception 'Unreviewed client execution of public functions: %', unreviewed;
  end if;
end;
$$;
create function public.werkflow_function_probe() returns integer language sql as 'select 1';
do $$
begin
  if has_function_privilege('anon', 'public.werkflow_function_probe()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.werkflow_function_probe()', 'EXECUTE') then
    raise exception 'A new public function inherited client execution';
  end if;
end;
$$;
drop function public.werkflow_function_probe();

-- Transactional probe of the migration role's actual defaults, not their prose.
create table public.werkflow_privilege_probe (id bigint generated by default as identity primary key);
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(api_role, 'public.werkflow_privilege_probe', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_sequence_privilege(api_role, 'public.werkflow_privilege_probe_id_seq', 'USAGE,SELECT,UPDATE') then
      raise exception 'New public objects inherited implicit grants for %', api_role;
    end if;
  end loop;
end;
$$;
drop table public.werkflow_privilege_probe;

-- No SECURITY DEFINER function in the exposed schema may be
-- executable by anon or authenticated, and the service-role lookups stay closed.
do $$
declare
  offender text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into offender
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
    );
  if offender is not null then
    raise exception 'security definer functions executable by client roles: %', offender;
  end if;

  foreach offender in array array[
    'public.check_user_exists_by_email(text)',
    'app_private.check_user_exists_by_email(text)',
    'public.get_invite_by_code(text)',
    'app_private.get_invite_by_code(text)',
    'public.set_job_assignment_organization()',
    'public.guard_automatic_time_entry_timestamps()',
    'public.update_updated_at_column()'
  ] loop
    if has_function_privilege('anon', offender, 'execute')
      or has_function_privilege('authenticated', offender, 'execute') then
      raise exception '% is executable by a client role', offender;
    end if;
  end loop;

  -- The RLS helper functions must stay callable by signed-in users, otherwise
  -- every organization policy would fail closed for legitimate members.
  if not has_function_privilege('authenticated', 'app_private.get_user_org_ids(uuid)', 'execute') then
    raise exception 'get_user_org_ids lost its authenticated grant';
  end if;
end;
$$;

-- No SECURITY DEFINER function in public or app_private is executable by anon,
-- also not through PUBLIC. authenticated executes exactly the reviewed RLS
-- helpers below: each one appears in the policies of the named tables, which
-- PostgreSQL evaluates as the querying role. app_private is not exposed
-- through the Data API, so none of them is a client RPC. A new definer
-- function executable by authenticated, or a listed one that lost the grant
-- or no longer exists, fails until this list changes with a reason.
do $$
declare
  reviewed constant text[] := array[
    -- documents, document_links, document_versions, document_audit_events
    'app_private.can_access_document(uuid, uuid)',
    -- inventory_movements, job_material_lines
    'app_private.can_access_job_inventory(uuid, uuid)',
    -- work_artifacts
    'app_private.can_access_work_artifact(uuid, uuid)',
    -- work_artifact_actions, job_instruction_item_evidence_fulfillments
    'app_private.can_access_work_artifact_target(uuid, uuid, uuid, uuid)',
    -- work_handover_packages
    'app_private.can_read_work_handover_root(uuid, uuid)',
    -- work_handover_draft_items, _events, _releases, _release_items
    'app_private.can_review_work_handover_package(uuid, uuid)',
    -- work_blocker_events
    'app_private.can_view_p1_14_blocker(uuid, uuid)',
    -- work_dependency_events
    'app_private.can_view_p1_14_dependency(uuid, uuid)',
    -- work_blockers, work_dependencies, work_execution_events, job_instruction_item_events
    'app_private.can_view_p1_14_work_target(uuid, uuid, uuid, uuid, uuid)',
    -- job_instruction_item_dependencies, job_instruction_item_evidence_requirements
    'app_private.can_view_work_instruction_item(uuid, uuid)',
    -- job_instruction_items
    'app_private.can_view_work_instruction_target(uuid, uuid, uuid, uuid)',
    -- personnel_documents, personnel_document_releases
    'app_private.current_user_can_access_personnel_document(uuid)',
    -- document_audit_events (personnel documents)
    'app_private.current_user_can_access_personnel_document_history(uuid)',
    -- document_versions (personnel documents)
    'app_private.current_user_can_access_personnel_document_version(uuid, integer)',
    -- manager visibility across clients, planning, time, teams, templates, jobs, projects and job_assignments
    'app_private.get_user_admin_or_manager_org_ids(uuid)',
    -- an employee's own work in jobs and job_assignments
    'app_private.get_user_assigned_job_ids(uuid)',
    -- the projects that hold an employee's own work
    'app_private.get_user_assigned_project_ids(uuid)',
    -- organization_capabilities
    'app_private.get_user_capability_ids(uuid)',
    -- own rows in dispatches, absences, schedules, teams and responsibilities
    'app_private.get_user_employee_record_ids(uuid)',
    -- membership scope of organizations, jobs, projects, time and realtime_deletions
    'app_private.get_user_org_ids(uuid)',
    -- planning_occurrences
    'app_private.get_user_planning_occurrence_ids()',
    -- teams
    'app_private.get_user_team_ids(uuid)',
    -- organization_responsibility_configurations
    'app_private.get_user_visible_responsibility_configuration_ids(uuid)',
    -- installed_equipment and its event, identifier and link tables
    'app_private.installed_equipment_actor_is_manager(uuid, uuid)',
    -- documents, document_folders, document_links, document_versions, document_audit_events
    'app_private.is_document_manager(uuid, uuid)',
    -- inventory tables and job_material_lines
    'app_private.is_inventory_manager(uuid, uuid)',
    -- time_accounts, adjustments and period result tables
    'app_private.is_p1_23_employee_record_actor(uuid, uuid, uuid)',
    -- time_periods and period result tables
    'app_private.is_p1_23_time_holder(uuid, uuid)',
    -- time_correction_requests
    'app_private.is_time_approval_holder(uuid, uuid, uuid)',
    -- work_artifact_actions
    'app_private.is_work_artifact_manager(uuid, uuid)',
    -- maintenance plans, coverages and due work
    'app_private.maintenance_actor_is_manager(uuid, uuid)',
    -- personnel lifecycle, onboarding and acknowledgement tables
    'app_private.p1_24_current_user_is_manager(uuid)',
    -- personnel lifecycle, onboarding and acknowledgement tables (own rows)
    'app_private.p1_24_current_user_is_self(uuid, uuid, boolean)',
    -- document_versions, document_audit_events
    'app_private.p1_24_is_protected_document(uuid)',
    -- service_cases and their event, link and relation tables
    'app_private.service_case_actor_is_manager(uuid, uuid)'
  ];
  offender text; unreviewed text; missing text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into offender
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private') and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if offender is not null then
    raise exception 'SECURITY DEFINER functions executable by anon: %', offender;
  end if;

  with granted as (
    select n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private') and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
  select string_agg(signature, ', ' order by signature) into unreviewed
  from granted where signature <> all (reviewed);
  if unreviewed is not null then
    raise exception 'Unreviewed authenticated execution of SECURITY DEFINER functions: %', unreviewed;
  end if;

  select string_agg(signature, ', ' order by signature) into missing
  from unnest(reviewed) as signature
  where to_regprocedure(signature) is null
    or not has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE')
    or not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(signature));
  if missing is not null then
    raise exception 'Definer inventory lists functions without an authenticated grant: %', missing;
  end if;
end;
$$;

-- The committed body of fulfill_instruction_evidence carries the
-- requirement-not-found guard twice (requirement lookup and item lookup).
do $$
declare
  guard_count integer;
begin
  select regexp_count(pg_get_functiondef('public.fulfill_instruction_evidence'::regproc), 'instruction_evidence_requirement_not_found')
    into guard_count;
  if guard_count <> 2 then
    raise exception 'fulfill_instruction_evidence body drifted: % guard occurrences', guard_count;
  end if;
end;
$$;

-- Inventory ledgers are append-only for signed-in managers.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('51000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'si-011-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"SI011"}', now(), now()),
('51000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'si-006-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"SI006"}', now(), now());

set local role service_role;

insert into public.organizations (id, name, admin_id, unique_code) values
('51000000-0000-0000-0000-000000000010', 'SI-011 SQL',
 '51000000-0000-0000-0000-000000000001', 'SI011SQL');

insert into public.inventory_items (id, organization_id, name) values
('51000000-0000-0000-0000-000000000020', '51000000-0000-0000-0000-000000000010', 'Rohr');
insert into public.inventory_locations (id, organization_id, name) values
('51000000-0000-0000-0000-000000000030', '51000000-0000-0000-0000-000000000010', 'Lager');
insert into public.inventory_movements (
  id, organization_id, item_id, location_id, movement_type,
  quantity_before, quantity_delta, quantity_after
) values (
  '51000000-0000-0000-0000-000000000040', '51000000-0000-0000-0000-000000000010',
  '51000000-0000-0000-0000-000000000020', '51000000-0000-0000-0000-000000000030',
  'stock_in', 0, 5, 5
);
insert into public.inventory_audit_events (id, organization_id, event_type) values
('51000000-0000-0000-0000-000000000050', '51000000-0000-0000-0000-000000000010', 'stock_adjusted');

-- The organization admin (an inventory manager under the policy) cannot rewrite the ledger.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

do $$
begin
  begin
    update public.inventory_movements set quantity_delta = 99
    where id = '51000000-0000-0000-0000-000000000040';
    raise exception 'inventory movement update was accepted';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm = 'inventory movement update was accepted' then raise; end if;
  end;
  begin
    delete from public.inventory_movements where id = '51000000-0000-0000-0000-000000000040';
    raise exception 'inventory movement delete was accepted';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm = 'inventory movement delete was accepted' then raise; end if;
  end;
  begin
    delete from public.inventory_audit_events where id = '51000000-0000-0000-0000-000000000050';
    raise exception 'inventory audit event delete was accepted';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm = 'inventory audit event delete was accepted' then raise; end if;
  end;
end;
$$;

-- The service role is bound by the same trigger outside an organization cascade.
set local role service_role;
do $$
begin
  begin
    update public.inventory_movements set quantity_delta = 99
    where id = '51000000-0000-0000-0000-000000000040';
    raise exception 'service-role ledger update was accepted';
  exception when raise_exception then
    if sqlerrm = 'service-role ledger update was accepted' then raise; end if;
  end;
end;
$$;

-- Fixture rows still exist unchanged.
do $$
declare
  delta numeric;
begin
  select quantity_delta into delta from public.inventory_movements
  where id = '51000000-0000-0000-0000-000000000040';
  if delta <> 5 then raise exception 'ledger row changed despite denial'; end if;
end;
$$;

-- A member with recorded time cannot be removed; the membership and the
-- history stay in place (containment until P1-33).
insert into public.organization_members (organization_id, user_id, role) values
('51000000-0000-0000-0000-000000000010', '51000000-0000-0000-0000-000000000002', 'employee');
-- The same member can be removed before recording time. Rejoin before the denial case.
do $$
begin
  if public.remove_member_with_time_capture(
    '51000000-0000-0000-0000-000000000010',
    '51000000-0000-0000-0000-000000000002',
    '51000000-0000-0000-0000-000000000001',
    gen_random_uuid()
  ) is distinct from false then raise exception 'unused member removal reported a clock-out'; end if;
  if exists (select 1 from public.organization_members
    where organization_id = '51000000-0000-0000-0000-000000000010'
      and user_id = '51000000-0000-0000-0000-000000000002'
  ) then raise exception 'unused member was not removed'; end if;
end;
$$;
insert into public.organization_members (organization_id, user_id, role) values
('51000000-0000-0000-0000-000000000010', '51000000-0000-0000-0000-000000000002', 'employee');
insert into public.time_entries (organization_id, user_id, entry_type, timestamp) values
('51000000-0000-0000-0000-000000000010', '51000000-0000-0000-0000-000000000002', 'clock_in', now());

do $$
begin
  begin
    perform public.remove_member_with_time_capture(
      '51000000-0000-0000-0000-000000000010',
      '51000000-0000-0000-0000-000000000002',
      '51000000-0000-0000-0000-000000000001',
      gen_random_uuid()
    );
    raise exception 'member with time history was removed';
  exception when raise_exception then
    if sqlerrm <> 'time_member_removal_has_history' then raise; end if;
  end;
  if not exists (
    select 1 from public.organization_members
    where organization_id = '51000000-0000-0000-0000-000000000010'
      and user_id = '51000000-0000-0000-0000-000000000002'
  ) then raise exception 'membership vanished despite the denial'; end if;
  if not exists (
    select 1 from public.time_entries
    where organization_id = '51000000-0000-0000-0000-000000000010'
      and user_id = '51000000-0000-0000-0000-000000000002'
  ) then raise exception 'time history vanished despite the denial'; end if;
end;
$$;

-- Deleting the organization cascades through the ledger (legitimate teardown).
reset role;
delete from public.organizations where id = '51000000-0000-0000-0000-000000000010';
do $$
begin
  if exists (select 1 from public.inventory_movements where organization_id = '51000000-0000-0000-0000-000000000010') then
    raise exception 'organization cascade left ledger rows';
  end if;
end;
$$;

-- Account deletion: deleting the Auth user of a member with recorded time is
-- refused before its cascade removes the membership and the time history,
-- whatever the member's access state. Suspended (legacy entry) and ended
-- (canonical session) members are refused; a member without time and a
-- former member of a deleted organization pass.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('52000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'account-deletion-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Deletion"}', now(), now()),
('52000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'account-deletion-suspended@example.test', '', now(), '{}',
 '{"first_name":"Suspended","last_name":"Deletion"}', now(), now()),
('52000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'account-deletion-ended@example.test', '', now(), '{}',
 '{"first_name":"Ended","last_name":"Deletion"}', now(), now()),
('52000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'account-deletion-no-time@example.test', '', now(), '{}',
 '{"first_name":"NoTime","last_name":"Deletion"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('52000000-0000-0000-0000-000000000010', 'Account deletion SQL',
 '52000000-0000-0000-0000-000000000001', 'ACCDELSQL');
insert into public.organization_members (organization_id, user_id, role) values
('52000000-0000-0000-0000-000000000010', '52000000-0000-0000-0000-000000000002', 'employee'),
('52000000-0000-0000-0000-000000000010', '52000000-0000-0000-0000-000000000003', 'employee'),
('52000000-0000-0000-0000-000000000010', '52000000-0000-0000-0000-000000000004', 'employee');
insert into public.time_entries (organization_id, user_id, entry_type, timestamp) values
('52000000-0000-0000-0000-000000000010', '52000000-0000-0000-0000-000000000002', 'clock_in', now());

do $$
declare
  v_org constant uuid := '52000000-0000-0000-0000-000000000010';
  v_admin constant uuid := '52000000-0000-0000-0000-000000000001';
  v_suspended constant uuid := '52000000-0000-0000-0000-000000000002';
  v_ended constant uuid := '52000000-0000-0000-0000-000000000003';
  v_record uuid;
begin
  select id into v_record from public.employee_records where organization_id = v_org and user_id = v_suspended;
  perform public.set_personnel_access_transition(
    v_admin, v_org, v_record, 0, 'suspend_now', clock_timestamp(), 'Gesperrt',
    gen_random_uuid(), repeat('a', 64)
  );

  select id into v_record from public.employee_records where organization_id = v_org and user_id = v_ended;
  perform set_config('app.time_capture_write', 'true', true);
  insert into public.time_sessions (
    organization_id, employee_record_id, user_id, status, started_at, ended_at, created_by, ended_by
  ) values (
    v_org, v_record, v_ended, 'closed', now() - interval '4 hours', now() - interval '1 hour', v_ended, v_ended
  );
  perform set_config('app.time_capture_write', '', true);
  perform public.set_personnel_access_transition(
    v_admin, v_org, v_record, 0, 'end_access', clock_timestamp(), 'Zugang beendet',
    gen_random_uuid(), repeat('b', 64)
  );

  if (select lifecycle.state from public.personnel_access_lifecycles lifecycle
      join public.employee_records record on record.id = lifecycle.employee_record_id
      where record.organization_id = v_org and record.user_id = v_suspended) <> 'suspended'
     or (select lifecycle.state from public.personnel_access_lifecycles lifecycle
      where lifecycle.employee_record_id = v_record) <> 'ended'
  then raise exception 'account deletion fixture did not reach its access states'; end if;
end;
$$;

do $$
declare
  v_user uuid;
begin
  foreach v_user in array array[
    '52000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000003'
  ]::uuid[] loop
    begin
      delete from auth.users where id = v_user;
      raise exception 'account of a member with recorded time was deleted';
    exception when raise_exception then
      if sqlerrm <> 'account_deletion_member_has_time_history' then raise; end if;
    end;
    if not exists (select 1 from public.organization_members where user_id = v_user)
      or not exists (select 1 from public.profiles where id = v_user)
    then raise exception 'refused account deletion removed the membership or the profile'; end if;
  end loop;
  if not exists (select 1 from public.time_entries where user_id = '52000000-0000-0000-0000-000000000002')
    or not exists (select 1 from public.time_sessions where user_id = '52000000-0000-0000-0000-000000000003')
  then raise exception 'refused account deletion removed recorded time'; end if;

  delete from auth.users where id = '52000000-0000-0000-0000-000000000004';
  if exists (select 1 from public.profiles where id = '52000000-0000-0000-0000-000000000004')
  then raise exception 'account of a member without time kept its profile'; end if;
end;
$$;

delete from public.organizations where id = '52000000-0000-0000-0000-000000000010';
delete from auth.users where id = '52000000-0000-0000-0000-000000000002';
do $$
begin
  if exists (select 1 from auth.users where id = '52000000-0000-0000-0000-000000000002')
  then raise exception 'former member of a deleted organization could not be deleted'; end if;
end;
$$;

rollback;
