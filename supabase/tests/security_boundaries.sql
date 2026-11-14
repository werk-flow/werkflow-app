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
savepoint policy_probe;
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
rollback to savepoint policy_probe;

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
savepoint policy_probe;
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
rollback to savepoint policy_probe;

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
savepoint policy_probe;
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
rollback to savepoint policy_probe;

-- Every app_private function that reads or writes tenant rows takes the
-- organization: an argument named for it (p_organization_id, p_org_id), or a
-- whole tenant row, which carries its organization_id. A helper keyed by an id
-- alone trusts whichever organization that id belongs to (review of
-- werk-flow/werkflow-planning#431, class c). A tenant row is one of a public
-- table or view with an organization_id column; a function reads it when its
-- body names public.<table>. Trigger functions are out of scope: they read the
-- organization from the row they guard. Each exemption names one signature, so
-- a new overload gets no reviewed reason by its name, and carries the reason
-- review accepted, and a stale exemption fails until removed.
create function pg_temp.tenant_helper_exemptions() returns table (name text, reason text)
language sql as $$
  values
    ('can_access_document(uuid,uuid)', 'RLS object check: loads the document by id and checks the user within its own organization'),
    ('can_access_job_inventory(uuid,uuid)', 'RLS object check: loads the job by id and checks the user within its own organization'),
    ('can_access_personnel_document(uuid,uuid)', 'RLS object check: loads the personnel document by id and checks the user within its own organization'),
    ('can_access_personnel_document_history(uuid,uuid)', 'RLS object check: loads the personnel document by id and checks the user within its own organization'),
    ('can_access_personnel_document_version(uuid,integer,uuid)', 'RLS object check: loads the personnel document by id and checks the user within its own organization'),
    ('can_access_work_artifact(uuid,uuid)', 'RLS object check: loads the artifact by id and checks the user within its own organization'),
    ('can_read_work_handover_root(uuid,uuid)', 'RLS object check: loads the handover package by id and checks the actor within its own organization'),
    ('can_review_work_handover_package(uuid,uuid)', 'RLS object check: loads the handover package by id and checks the actor within its own organization'),
    ('can_view_p1_14_blocker(uuid,uuid)', 'RLS object check: loads the blocker by id and checks the user within its own organization'),
    ('can_view_p1_14_dependency(uuid,uuid)', 'RLS object check: loads the dependency by id and checks the user within its own organization'),
    ('is_work_artifact_lead_reviewer(uuid,uuid)', 'Object check: loads the artifact by id and asks for the lead within its own organization'),
    ('can_view_work_instruction_item(uuid,uuid)', 'RLS object check: loads the instruction item by id and checks the user within its own organization'),
    ('employee_record_has_effective_access(uuid)', 'RLS object check: reads the employee record by id and its own organization''s access state'),
    ('p1_24_is_protected_document(uuid)', 'RLS object check: whether a document id is a personnel document; the calling policy checks the organization'),
    ('get_user_admin_or_manager_org_ids(uuid)', 'RLS helper: the caller''s own organizations; each policy pairs the result with the row''s organization_id'),
    ('get_user_admin_org_ids(uuid)', 'RLS helper: the caller''s own organizations; each policy pairs the result with the row''s organization_id'),
    ('get_user_org_ids(uuid)', 'RLS helper: the caller''s own organizations; each policy pairs the result with the row''s organization_id'),
    ('get_user_assigned_job_ids(uuid)', 'RLS helper: the caller''s own assignments across their organizations; the policy also checks the row''s organization'),
    ('get_user_assigned_project_ids(uuid)', 'RLS helper: the caller''s own assignments across their organizations; the policy also checks the row''s organization'),
    ('get_user_capability_ids(uuid)', 'RLS helper: the caller''s own records across their organizations; the policy also checks the row''s organization'),
    ('get_user_employee_record_ids(uuid)', 'RLS helper: the caller''s own records across their organizations; the policy also checks the row''s organization'),
    ('get_user_planning_occurrence_ids()', 'RLS helper: the caller''s own assignments, joined within each record''s organization'),
    ('get_user_team_ids(uuid)', 'RLS helper: the caller''s own teams across their organizations; the policy also checks the row''s organization'),
    ('get_user_visible_responsibility_configuration_ids(uuid)', 'RLS helper: the caller''s own responsibilities across their organizations; the policy also checks the row''s organization'),
    ('get_invite_by_code(text)', 'An invite code names its own organization; the caller has none yet'),
    ('redeem_organization_invite_for_user(text,uuid)', 'An invite code names its own organization; the caller has none yet'),
    ('prune_realtime_deletions()', 'Maintenance across every organization by age, from no request'),
    ('sync_begun_inventory_item_prices()', 'Maintenance across every organization from the hourly cron, from no request; it syncs each organization''s prices with that organization''s own rows only'),
    ('assert_time_correction_sources_current(uuid,bigint)', 'Step of a public write that resolved the organization; reads the request it loaded there'),
    ('p1_22_revise_time_correction_request_impl(uuid,uuid,uuid,bigint,text,text,text,jsonb,jsonb,jsonb)', 'Step of a public write that resolved the organization; reads the request it loaded there'),
    ('existing_document_retention_class(uuid)', 'Migration-only backfill across every organization; execution is revoked from every application role'),
    ('resolve_project_execution_state(uuid)', 'Step of a public write or reader that resolved the organization; reads the project it loaded there'),
    ('sync_planning_dispatch_for_occurrence(uuid)', 'Step of a planning write that resolved the organization; reads the occurrence it wrote there'),
    ('validate_submitted_work_artifact_revision(uuid)', 'Step of a public write that resolved the organization; reads the revision it loaded there'),
    ('validate_work_handover_sources(uuid)', 'Step of a public write that resolved the organization; reads the package it loaded there'),
    ('work_dependency_is_satisfied(uuid)', 'Step of a public write that resolved the organization; reads the dependency it loaded there'),
    ('work_template_dependency_has_cycle(uuid)', 'Step of a public write that resolved the organization; reads the template version it loaded there')
$$;

create function pg_temp.tenant_helpers_without_organization() returns table (name text)
language sql as $$
  with tenant as (
    select c.relname, c.reltype from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
      )
  )
  select replace(p.oid::regprocedure::text, 'app_private.', '') from pg_proc p
  where p.pronamespace = 'app_private'::regnamespace
    and p.prorettype <> 'trigger'::regtype
    and pg_get_function_identity_arguments(p.oid) !~ '(organization|org)_id\M'
    and not exists (select 1 from tenant where tenant.reltype = any (p.proargtypes::oid[]))
    and exists (select 1 from tenant where p.prosrc ~* ('\mpublic\.' || tenant.relname || '\M'));
$$;

-- An exemption is stale when its signature is no longer reported: the
-- function now takes the organization, was replaced by another signature, or
-- is gone.
create function pg_temp.stale_tenant_helper_exemptions(p_names text[]) returns text
language sql as $$
  select string_agg(exempted.name, ', ' order by exempted.name) from unnest(p_names) exempted (name)
  where exempted.name not in (select found.name from pg_temp.tenant_helpers_without_organization() found);
$$;

do $$
declare offender text;
declare stale text;
begin
  select string_agg('app_private.' || found.name, ', ' order by found.name) into offender
  from pg_temp.tenant_helpers_without_organization() found
  where found.name not in (select exemption.name from pg_temp.tenant_helper_exemptions() exemption);
  if offender is not null then
    raise exception 'app_private reads tenant rows without taking the organization (add p_organization_id): %', offender;
  end if;
  stale := pg_temp.stale_tenant_helper_exemptions(array(select exemption.name from pg_temp.tenant_helper_exemptions() exemption));
  if stale is not null then
    raise exception 'Tenant helper exemptions that no longer apply (remove them): %', stale;
  end if;
end;
$$;

-- Probe: the reviewed shape of the finding. A current-version helper keyed by
-- the work id alone is reported; the same helper taking the organization, or a
-- whole tenant row, is not, and an unscoped overload of an exempted name is.
savepoint tenant_helper_probe;
create function app_private.werkflow_tenant_probe(p_work_id uuid) returns setof public.jobs
language sql stable as $probe$ select * from public.jobs job where job.id = p_work_id $probe$;
-- Unquoted identifiers fold to lower case, so an uppercase reference names the same table.
create function app_private.werkflow_tenant_probe(p_work_id text) returns setof public.jobs
language sql stable as $probe$ SELECT * FROM PUBLIC.JOBS job WHERE job.id = p_work_id::uuid $probe$;
create function app_private.werkflow_tenant_probe_scoped(p_organization_id uuid, p_work_id uuid)
returns setof public.jobs language sql stable as $probe$
  select * from public.jobs job where job.organization_id = p_organization_id and job.id = p_work_id
$probe$;
create function app_private.werkflow_tenant_probe_row(p_job public.jobs) returns setof public.jobs
language sql stable as $probe$
  select * from public.jobs job where job.organization_id = p_job.organization_id and job.id = p_job.id
$probe$;
-- An unscoped overload of an exempted helper inherits no exemption.
create function app_private.get_user_org_ids(p_user_id uuid, p_role text) returns setof uuid
language sql stable as $probe$
  select member.organization_id from public.organization_members member
  where member.user_id = p_user_id and member.role::text = p_role
$probe$;
do $$
declare found text;
begin
  select string_agg(helper.name, ', ' order by helper.name) into found
  from pg_temp.tenant_helpers_without_organization() helper
  where helper.name like 'werkflow_tenant_probe%' or helper.name like 'get_user_org_ids(%'
    and helper.name not in (select exemption.name from pg_temp.tenant_helper_exemptions() exemption);
  if found is distinct from 'get_user_org_ids(uuid,text), werkflow_tenant_probe(text), werkflow_tenant_probe(uuid)' then
    raise exception 'Tenant helper check missed the probe or flagged a scoped one: %', found;
  end if;
  -- A helper that gained the organization, and one that is gone, leave stale exemptions.
  found := pg_temp.stale_tenant_helper_exemptions(
    array['werkflow_tenant_probe(uuid)', 'werkflow_tenant_probe_scoped(uuid,uuid)', 'werkflow_tenant_probe_gone(uuid)']
  );
  if found is distinct from 'werkflow_tenant_probe_gone(uuid), werkflow_tenant_probe_scoped(uuid,uuid)' then
    raise exception 'Stale exemption check missed a scoped or removed helper: %', found;
  end if;
end;
$$;
rollback to savepoint tenant_helper_probe;

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

-- A public SECURITY DEFINER function is a server-only entry
-- (docs/technical/security.md, "Add a privileged function"). No role but
-- service_role executes it, also not through PUBLIC. Unless it is a trigger,
-- it pins search_path to '', and no role, service_role included, executes a
-- volatile app_private function it reaches through app_private or public
-- calls, so no caller skips the entry's recheck of role and organization. A
-- stable helper writes nothing; the RLS helpers among them have their own
-- inventory below. A call is found by its schema-qualified name in a body,
-- with optional quotes and spaces; a call through dynamic SQL is not.
-- legacy_definer_breaches names each breach that predates the rule, as the
-- line the check reports; lib/testing/publication/shrink-only-lists.ts keeps
-- it from growing, and a listed breach that is gone fails until it leaves the
-- list (docs/technical/enforcement-ladder-backlog.md, "Legacy definer entries").
create function pg_temp.legacy_definer_breaches() returns jsonb language plpgsql as $$
declare
  legacy_definer_breaches constant jsonb := jsonb_build_object(
    'public.generate_job_number(uuid) does not pin search_path to empty',
      'older function, pinned to public',
    'public.generate_personnel_number(uuid) does not pin search_path to empty',
      'older function, pinned to public',
    'public.generate_project_number(uuid) does not pin search_path to empty',
      'older function, pinned to public',
    'public.generate_request_number(uuid) does not pin search_path to empty',
      'older function, pinned to public',
    'public.get_org_members_for_user(uuid, uuid) does not pin search_path to empty',
      'older function, pinned to public',
    'public.get_user_admin_or_manager_org_ids(uuid) does not pin search_path to empty',
      'older function, pinned to public',
    'public.get_user_org_ids(uuid) does not pin search_path to empty',
      'older function, pinned to public',
    'public.redeem_organization_invite_for_user(text, uuid) does not pin search_path to empty',
      'older function, pinned to public',
    'step app_private.assert_installed_equipment_manager(uuid, uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.assert_maintenance_equipment_set(uuid, uuid, uuid, uuid, jsonb, text) executable by service_role',
      'older step, granted before the rule',
    'step app_private.assert_maintenance_manager(uuid, uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.assert_p1_23_period_open(uuid, date) executable by service_role',
      'older step, granted before the rule',
    'step app_private.assert_service_case_manager(uuid, uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.get_org_members_for_user(uuid, uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.insert_maintenance_revision_equipment(uuid, uuid, uuid, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.is_time_approval_holder(uuid, uuid, uuid) executable by authenticated',
      'RLS helper declared volatile',
    'step app_private.lock_maintenance_operation(uuid, text, uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.lock_service_case_operation(uuid, text, uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.next_installed_equipment_number(uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.next_maintenance_number(uuid, text) executable by service_role',
      'older step, granted before the rule',
    'step app_private.next_service_case_number(uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.p1_24_assert_replay(uuid, uuid, text) executable by service_role',
      'older step, granted before the rule',
    'step app_private.p1_24_record_operation(uuid, uuid, text, text, uuid, uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.project_plan_onto_job(uuid, uuid, uuid, uuid[]) executable by service_role',
      'older step, granted before the rule',
    'step app_private.record_installed_equipment_event(uuid, uuid, installed_equipment_event_type, installed_equipment_state, installed_equipment_state, timestamp with time zone, uuid, text, text, uuid, uuid, jsonb, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.record_maintenance_coverage_event(uuid, uuid, maintenance_coverage_event_type, uuid, text, text, uuid, jsonb, jsonb, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.record_maintenance_due_event(uuid, uuid, maintenance_due_event_type, uuid, text, text, uuid, jsonb, jsonb, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.record_maintenance_plan_event(uuid, uuid, maintenance_plan_event_type, uuid, text, text, uuid, jsonb, jsonb, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.record_planning_operation_assessment(uuid, uuid, jsonb, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.record_service_case_event(uuid, uuid, service_case_event_type, uuid, text, text, uuid, jsonb, jsonb, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.redeem_organization_invite_for_user(text, uuid) executable by service_role',
      'older step, granted before the rule',
    'step app_private.sync_installed_equipment_identifiers(uuid, uuid, uuid, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.sync_service_case_equipment_links(uuid, uuid, uuid, jsonb) executable by service_role',
      'older step, granted before the rule',
    'step app_private.transition_work_execution_for_handover(uuid, uuid, text, uuid, bigint, work_execution_state, text, boolean, text) executable by service_role',
      'older step, granted before the rule',
    'step app_private.validate_time_segment_input(uuid, uuid, org_role, time_segment_kind, time_allocation_kind, uuid, planning_internal_type, time_travel_route, time_travel_role, time_standby_context) executable by service_role',
      'older step, granted before the rule'
  );
begin
  return legacy_definer_breaches;
end;
$$;

create function pg_temp.definer_entry_breaches() returns text language sql as $$
  with recursive routine as (
    select p.oid, p.prosrc, n.nspname, p.proname,
      n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as signature,
      p.prosecdef, p.prorettype = 'trigger'::regtype as is_trigger, p.provolatile = 'v' as volatile,
      coalesce(p.proconfig @> array['search_path=""'], false) as pinned
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private')
  ), entry as (
    select * from routine where nspname = 'public' and prosecdef
  ), reached (oid) as (
    select entry.oid from entry where not entry.is_trigger
    union
    select callee.oid from reached join routine caller on caller.oid = reached.oid
    join routine callee on case when strpos(caller.prosrc, callee.proname) > 0
      then caller.prosrc ~* ('\m"?' || callee.nspname || '"?\s*\.\s*"?' || callee.proname || '"?\s*\(')
      else false end
  ), executor (oid, role_name) as (
    -- direct grants, and what a client role inherits through membership
    select p.oid, case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where acl.privilege_type = 'EXECUTE' and acl.grantee <> p.proowner
    union
    select routine.oid, client.role_name from routine
    cross join (values ('anon'), ('authenticated')) as client (role_name)
    where has_function_privilege(client.role_name, routine.oid, 'EXECUTE')
  ), breach (line) as (
    select entry.signature || ' executable by ' || executor.role_name
    from entry join executor on executor.oid = entry.oid where executor.role_name <> 'service_role'
    union
    select entry.signature || ' does not pin search_path to empty' from entry
    where not entry.is_trigger and not entry.pinned
    union
    select 'step ' || routine.signature || ' executable by ' || executor.role_name
    from reached join routine on routine.oid = reached.oid
    join executor on executor.oid = routine.oid
    where routine.nspname = 'app_private' and routine.volatile and not routine.is_trigger
  ), legacy (line) as (
    select jsonb_object_keys(pg_temp.legacy_definer_breaches())
  ), finding (line) as (
    select 'unlisted: ' || line from breach where line not in (select line from legacy)
    union all
    select 'listed but gone: ' || line from legacy where line not in (select line from breach)
  )
  select string_agg(line, '; ' order by line) from finding;
$$;

do $$
declare offender text := pg_temp.definer_entry_breaches();
begin
  if offender is not null then
    raise exception 'SECURITY DEFINER entry rule broken: %', offender;
  end if;
end;
$$;

-- Probe: an inventory entry granted to authenticated, one that lost its
-- search_path, a step granted to service_role, and a step reached through a
-- public invoker function with a quoted, spaced call must each be reported.
savepoint definer_entry_probe;
grant execute on function public.save_inventory_item(uuid, uuid, uuid, jsonb, text, text, uuid, numeric)
  to authenticated;
alter function public.import_inventory_row(uuid, uuid, uuid, jsonb, text, text, text, text, numeric, text)
  reset search_path;
grant execute on function app_private.lock_inventory_manager(uuid, uuid) to service_role;
create function app_private.werkflow_step_probe() returns void language sql volatile as 'select';
grant execute on function app_private.werkflow_step_probe() to service_role;
create function public.werkflow_hop_probe() returns void language plpgsql set search_path = '' as
  $body$ begin perform "app_private" . "werkflow_step_probe" (); end; $body$;
create function public.werkflow_entry_probe() returns void language plpgsql security definer
  set search_path = '' as $body$ begin perform public.werkflow_hop_probe(); end; $body$;
do $$
begin
  if pg_temp.definer_entry_breaches() is distinct from concat_ws('; ',
    'unlisted: public.import_inventory_row(uuid, uuid, uuid, jsonb, text, text, text, text, numeric, text) does not pin search_path to empty',
    'unlisted: public.save_inventory_item(uuid, uuid, uuid, jsonb, text, text, uuid, numeric) executable by authenticated',
    'unlisted: step app_private.lock_inventory_manager(uuid, uuid) executable by service_role',
    'unlisted: step app_private.werkflow_step_probe() executable by service_role'
  ) then
    raise exception 'SECURITY DEFINER entry rule missed the probe: %', pg_temp.definer_entry_breaches();
  end if;
end;
$$;
rollback to savepoint definer_entry_probe;

-- The service-role lookups and the client-facing wrappers stay closed.
do $$
declare
  offender text;
begin
  foreach offender in array array[
    'public.check_user_exists_by_email(text)',
    'app_private.check_user_exists_by_email(text)',
    'public.get_invite_by_code(text)',
    'app_private.get_invite_by_code(text)',
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
    -- organization_exports: only an Admin hears of an export
    'app_private.get_user_admin_org_ids(uuid)',
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
  if guard_count is distinct from 2 then
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
  if delta is distinct from 5 then raise exception 'ledger row changed despite denial'; end if;
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
      where record.organization_id = v_org and record.user_id = v_suspended) is distinct from 'suspended'
     or (select lifecycle.state from public.personnel_access_lifecycles lifecycle
      where lifecycle.employee_record_id = v_record) is distinct from 'ended'
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

-- Work billing parties are a ledger (werk-flow/werkflow-planning#327): no API
-- role may rewrite or delete a version, the history guard refuses even the
-- owner role, and only a deleted actor's reference-nulling and a deleted
-- work's cascade clean up.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('53270000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-ledger-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Ledger"}', now(), now()),
('53270000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-ledger-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Ledger"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('53270000-0000-4000-8000-000000000010', 'Billing ledger SQL',
 '53270000-0000-4000-8000-000000000001', 'BILLLEDG');
insert into public.organization_members (organization_id, user_id, role) values
('53270000-0000-4000-8000-000000000010', '53270000-0000-4000-8000-000000000002', 'buero');
insert into public.clients (id, organization_id, name, client_type, address) values
('53270000-0000-4000-8000-000000000020', '53270000-0000-4000-8000-000000000010',
 'WEG Ahornweg 1', 'gewerblich', 'Ahornweg 1, 10115 Berlin'),
('53270000-0000-4000-8000-000000000021', '53270000-0000-4000-8000-000000000010',
 'Hausverwaltung Ahorn GmbH', 'gewerblich', 'Hofweg 9, 10117 Berlin');
-- The job's default version comes with it; the office's choice adds one with its actor.
insert into public.jobs (id, organization_id, title, job_number, client_id, status, created_by) values
('53270000-0000-4000-8000-000000000030', '53270000-0000-4000-8000-000000000010', 'Heizung prüfen',
 'L-30', '53270000-0000-4000-8000-000000000020', 'nicht_bearbeitet',
 '53270000-0000-4000-8000-000000000001');
set local role service_role;
select public.set_work_billing_parties('53270000-0000-4000-8000-000000000002',
  '53270000-0000-4000-8000-000000000010', 'job', '53270000-0000-4000-8000-000000000030',
  '53270000-0000-4000-8000-000000000020', '53270000-0000-4000-8000-000000000021',
  (select max(version) from public.work_billing_parties
    where work_id = '53270000-0000-4000-8000-000000000030'));

-- The server role holds no UPDATE or DELETE grant; a browser session holds none at all.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['service_role', 'authenticated'] loop
    execute format('set local role %I', v_role);
    begin
      update public.work_billing_parties set recipient_name = 'Andere'
      where work_id = '53270000-0000-4000-8000-000000000030';
      raise exception 'billing party update was accepted for %', v_role;
    exception when insufficient_privilege then
      null;
    end;
    begin
      delete from public.work_billing_parties where work_id = '53270000-0000-4000-8000-000000000030';
      raise exception 'billing party delete was accepted for %', v_role;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end;
$$;

-- The owner role passes the grant and meets the history guard.
reset role;
do $$
begin
  begin
    update public.work_billing_parties set recipient_name = 'Andere'
    where work_id = '53270000-0000-4000-8000-000000000030';
    raise exception 'privileged billing party update was accepted';
  exception when raise_exception then
    if sqlerrm is distinct from 'event_ledger_history_immutable' then raise; end if;
  end;
  begin
    delete from public.work_billing_parties where work_id = '53270000-0000-4000-8000-000000000030';
    raise exception 'privileged billing party delete was accepted';
  exception when raise_exception then
    if sqlerrm is distinct from 'event_ledger_history_immutable' then raise; end if;
  end;
  if (select count(*) from public.work_billing_parties
      where work_id = '53270000-0000-4000-8000-000000000030') is distinct from 2::bigint
    or exists (select 1 from public.work_billing_parties
      where work_id = '53270000-0000-4000-8000-000000000030' and recipient_name = 'Andere')
  then raise exception 'a refused billing party edit changed the history'; end if;
end;
$$;

-- Permitted cleanup: a deleted account leaves its versions without an actor,
-- and a deleted work takes its versions with it.
delete from public.organization_members
where organization_id = '53270000-0000-4000-8000-000000000010'
  and user_id = '53270000-0000-4000-8000-000000000002';
delete from auth.users where id = '53270000-0000-4000-8000-000000000002';
do $$
begin
  if (select count(*) from public.work_billing_parties
      where work_id = '53270000-0000-4000-8000-000000000030' and set_by is null) is distinct from 2::bigint
  then raise exception 'a deleted account did not leave its billing party versions without an actor'; end if;
end;
$$;
delete from public.jobs where id = '53270000-0000-4000-8000-000000000030';
do $$
begin
  if exists (select 1 from public.work_billing_parties
    where work_id = '53270000-0000-4000-8000-000000000030')
  then raise exception 'a deleted job left its billing party versions'; end if;
end;
$$;

rollback;
