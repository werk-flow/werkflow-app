-- What a signed-in user can read and write through the Data API with their own
-- JWT (docs/technical/security.md, "Database"). Runs inside one transaction
-- against the local stack and rolls back.
--
-- Work: Admin and Büro read every job, project and assignment of their
-- organization; an employee reads only the jobs they are assigned to, the
-- assignments of those jobs and the projects that contain one of them
-- (docs/features/jobs-and-projects.md, "Assignment and qualifications").
-- Profiles: a user changes their own name and avatar, never the email the
-- Auth account owns.
-- Suspension: RLS consults effective personnel access, so a Büro member or an
-- employee suspended through set_personnel_access_transition reads nothing of
-- any table family, although the membership, the employee record link and the
-- assignments stay (docs/technical/security.md, "Revocation boundaries"). A
-- prestart employee reads their onboarding state but not their Zeitkonto.
-- Substitutes: a substitute reads through a delegation only while the holder
-- who named them has effective access.
-- Arbeitsnachweis: a client reads only the artifact rows.
-- Revisions, actions and all detail tables carry content the
-- server hides from coworkers (lib/work-artifacts/actions.ts), so only the
-- service role reads them.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('cb000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"CRB"}', now(), now()),
('cb000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-buero@example.test', '', now(), '{}',
 '{"first_name":"Buero","last_name":"CRB"}', now(), now()),
('cb000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"CRB"}', now(), now()),
('cb000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"CRB"}', now(), now()),
('cb000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-foreign@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"CRB"}', now(), now());

set local role service_role;

insert into public.organizations (id, name, admin_id, unique_code) values
('cb000000-0000-4000-8000-000000000010', 'CRB SQL', 'cb000000-0000-4000-8000-000000000001', 'CRBSQL01'),
('cb000000-0000-4000-8000-000000000011', 'CRB Fremd', 'cb000000-0000-4000-8000-000000000005', 'CRBSQL02');

-- Creating an organization makes its admin a member.
insert into public.organization_members (organization_id, user_id, role) values
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000002', 'buero'),
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000003', 'employee'),
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000004', 'employee');

-- Project A holds the employee's job and a sibling job; project B holds only
-- the colleague's job; one standalone job is unassigned.
insert into public.projects (id, organization_id, name, project_number, created_by) values
('cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000010', 'Projekt A', 'CRB-P-1',
 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000021', 'cb000000-0000-4000-8000-000000000010', 'Projekt B', 'CRB-P-2',
 'cb000000-0000-4000-8000-000000000001');

insert into public.jobs (id, organization_id, project_id, title, job_number, created_by) values
('cb000000-0000-4000-8000-000000000030', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000020', 'Eigener Auftrag', 'CRB-1', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000031', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000020', 'Geschwister-Auftrag', 'CRB-2', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000032', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000021', 'Auftrag der Kollegin', 'CRB-3', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000033', 'cb000000-0000-4000-8000-000000000010',
 null, 'Offener Auftrag', 'CRB-4', 'cb000000-0000-4000-8000-000000000001');

-- The employee and the colleague share the employee's job; the colleague
-- alone works the job in project B.
insert into public.job_assignments (job_id, user_id, assigned_by) values
('cb000000-0000-4000-8000-000000000030', 'cb000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000030', 'cb000000-0000-4000-8000-000000000004', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000032', 'cb000000-0000-4000-8000-000000000004', 'cb000000-0000-4000-8000-000000000001');

create function pg_temp.visible_work() returns text language sql as $$
  select concat_ws(' | ',
    'jobs=' || coalesce((select string_agg(job_number, ',' order by job_number) from public.jobs
      where organization_id in ('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000011')), ''),
    'projects=' || coalesce((select string_agg(project_number, ',' order by project_number) from public.projects
      where organization_id in ('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000011')), ''),
    'assignments=' || coalesce((select string_agg(j.job_number || ':' || right(a.user_id::text, 1), ','
        order by j.job_number, a.user_id)
      from public.job_assignments a join public.jobs j on j.id = a.job_id
      where a.organization_id in ('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000011')), ''),
    'assignments_raw=' || (select count(*) from public.job_assignments
      where organization_id in ('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000011'))::text
  );
$$;
grant execute on function pg_temp.visible_work() to authenticated;

create function pg_temp.expect_work(p_user uuid, p_expected text) returns void language plpgsql as $$
declare actual text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  actual := pg_temp.visible_work();
  execute 'reset role';
  if actual is distinct from p_expected then
    raise exception 'Visible work for % is "%", expected "%"', p_user, actual, p_expected;
  end if;
end;
$$;

reset role;

-- Admin and Büro read all work of their organization.
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000001',
  'jobs=CRB-1,CRB-2,CRB-3,CRB-4 | projects=CRB-P-1,CRB-P-2 | assignments=CRB-1:3,CRB-1:4,CRB-3:4 | assignments_raw=3');
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000002',
  'jobs=CRB-1,CRB-2,CRB-3,CRB-4 | projects=CRB-P-1,CRB-P-2 | assignments=CRB-1:3,CRB-1:4,CRB-3:4 | assignments_raw=3');

-- An employee reads their own job, its team, and the project that contains it;
-- no sibling job, no unassigned job, no foreign project.
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000003',
  'jobs=CRB-1 | projects=CRB-P-1 | assignments=CRB-1:3,CRB-1:4 | assignments_raw=2');
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000004',
  'jobs=CRB-1,CRB-3 | projects=CRB-P-1,CRB-P-2 | assignments=CRB-1:3,CRB-1:4,CRB-3:4 | assignments_raw=3');

-- Another organization's admin reads nothing of this organization.
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000005',
  'jobs= | projects= | assignments= | assignments_raw=0');

-- Removing the assignment removes the read at once.
set local role service_role;
delete from public.job_assignments
where job_id = 'cb000000-0000-4000-8000-000000000030' and user_id = 'cb000000-0000-4000-8000-000000000003';
reset role;
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000003',
  'jobs= | projects= | assignments= | assignments_raw=0');

-- A suspended or removed membership reads nothing, even with an assignment row.
set local role service_role;
insert into public.job_assignments (job_id, user_id, assigned_by) values
('cb000000-0000-4000-8000-000000000033', 'cb000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000001');
reset role;
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000003',
  'jobs=CRB-4 | projects= | assignments=CRB-4:3 | assignments_raw=1');
delete from public.organization_members
where organization_id = 'cb000000-0000-4000-8000-000000000010' and user_id = 'cb000000-0000-4000-8000-000000000003';
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000003',
  'jobs= | projects= | assignments= | assignments_raw=0');

-- A user edits their own name and avatar, never their email and never
-- another person's row.
select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
update public.profiles set first_name = 'Neu', avatar_path = null, updated_at = now()
where id = 'cb000000-0000-4000-8000-000000000004';
do $$
begin
  begin
    update public.profiles set email = 'attacker@example.test'
    where id = 'cb000000-0000-4000-8000-000000000004';
    raise exception 'profile email update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id, email, first_name, last_name)
    values (gen_random_uuid(), 'new@example.test', 'X', 'Y');
    raise exception 'profile insert was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = 'cb000000-0000-4000-8000-000000000004';
    raise exception 'profile delete was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.jobs (organization_id, title) values ('cb000000-0000-4000-8000-000000000010', 'Direkt');
    raise exception 'direct job insert was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
update public.profiles set first_name = 'Fremd'
where id = 'cb000000-0000-4000-8000-000000000001';
reset role;
do $$
begin
  if (select first_name from public.profiles where id = 'cb000000-0000-4000-8000-000000000004') <> 'Neu' then
    raise exception 'own profile name update was lost';
  end if;
  if (select email from public.profiles where id = 'cb000000-0000-4000-8000-000000000004') <> 'crb-colleague@example.test' then
    raise exception 'profile email changed';
  end if;
  if (select first_name from public.profiles where id = 'cb000000-0000-4000-8000-000000000001') <> 'Admin' then
    raise exception 'another person''s profile changed';
  end if;
end;
$$;


-- Suspension. A Büro member and an employee read every table family their
-- role and assignments reach, then nothing once suspended, with membership,
-- employee record and assignments in place.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('cb000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-suspended-buero@example.test', '', now(), '{}',
 '{"first_name":"Gesperrt","last_name":"Buero"}', now(), now()),
('cb000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-suspended-employee@example.test', '', now(), '{}',
 '{"first_name":"Gesperrt","last_name":"Employee"}', now(), now());

set local role service_role;
insert into public.organization_members (organization_id, user_id, role) values
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000006', 'buero'),
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000007', 'employee');
insert into public.projects (id, organization_id, name, project_number, created_by) values
('cb000000-0000-4000-8000-000000000022', 'cb000000-0000-4000-8000-000000000010', 'Projekt C', 'CRB-P-3',
 'cb000000-0000-4000-8000-000000000001');
insert into public.jobs (id, organization_id, project_id, title, job_number, created_by) values
('cb000000-0000-4000-8000-000000000034', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000022', 'Auftrag vor der Sperre', 'CRB-5', 'cb000000-0000-4000-8000-000000000001');
insert into public.job_assignments (job_id, user_id, assigned_by) values
('cb000000-0000-4000-8000-000000000034', 'cb000000-0000-4000-8000-000000000007', 'cb000000-0000-4000-8000-000000000001');
reset role;

-- One row per table family. These rows are written only through their RPCs;
-- the seed bypasses the write guards and validation triggers, so every
-- reference is set by hand.
create temporary table suspended_employee as
select id from public.employee_records
where organization_id = 'cb000000-0000-4000-8000-000000000010'
  and user_id = 'cb000000-0000-4000-8000-000000000007';
set local session_replication_role = replica;
insert into public.job_instruction_items (id, organization_id, job_id, content, created_by) values
('cb000000-0000-4000-8000-000000000120', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000034', 'Anweisung', 'cb000000-0000-4000-8000-000000000001');
insert into public.work_blockers (id, organization_id, project_id, is_legacy) values
('cb000000-0000-4000-8000-000000000121', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000022', true);
insert into public.work_artifacts (id, organization_id, kind, job_id, created_by) values
('cb000000-0000-4000-8000-000000000122', 'cb000000-0000-4000-8000-000000000010', 'site_diary',
 'cb000000-0000-4000-8000-000000000034', 'cb000000-0000-4000-8000-000000000007');
insert into public.work_artifact_revisions (
  id, organization_id, artifact_id, revision_number, kind, visibility, captured_at, title, created_by
) values
('cb000000-0000-4000-8000-000000000123', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000122', 1, 'site_diary', 'customer_facing', now(), 'Bautagebuch',
 'cb000000-0000-4000-8000-000000000007');
insert into public.work_artifact_defect_details (revision_id, organization_id, description, severity, location) values
('cb000000-0000-4000-8000-000000000123', 'cb000000-0000-4000-8000-000000000010', 'Undichte Leitung', 'high',
 'Keller');
insert into public.work_handover_packages (id, organization_id, job_id, created_by, updated_by) values
('cb000000-0000-4000-8000-000000000125', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000034', 'cb000000-0000-4000-8000-000000000001',
 'cb000000-0000-4000-8000-000000000001');
insert into public.inventory_items (id, organization_id, name) values
('cb000000-0000-4000-8000-000000000126', 'cb000000-0000-4000-8000-000000000010', 'Kupferrohr');
insert into public.job_material_lines (id, organization_id, item_id, job_id) values
('cb000000-0000-4000-8000-000000000127', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000126', 'cb000000-0000-4000-8000-000000000034');
insert into public.clients (id, organization_id, name) values
('cb000000-0000-4000-8000-000000000128', 'cb000000-0000-4000-8000-000000000010', 'Kunde CRB');
insert into public.client_sites (id, organization_id, client_id, name) values
('cb000000-0000-4000-8000-000000000129', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000128', 'Wohnhaus');
insert into public.service_cases (
  id, organization_id, case_number, intake_type, client_id, site_id, original_statement, summary,
  created_by, updated_by
) values
('cb000000-0000-4000-8000-000000000130', 'cb000000-0000-4000-8000-000000000010', 'SC-CRB-1', 'direct',
 'cb000000-0000-4000-8000-000000000128', 'cb000000-0000-4000-8000-000000000129', 'Heizung bleibt kalt',
 'Heizung kalt', 'cb000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001');
insert into public.installed_equipment (
  id, organization_id, client_id, site_id, equipment_number, name, category, state, created_by, updated_by
) values
('cb000000-0000-4000-8000-000000000131', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000128', 'cb000000-0000-4000-8000-000000000129', 'ANL-CRB-1', 'Gaskessel',
 'heat_generation', 'active', 'cb000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001');
insert into public.maintenance_plans (id, organization_id, plan_number, client_id, site_id, created_by, updated_by) values
('cb000000-0000-4000-8000-000000000132', 'cb000000-0000-4000-8000-000000000010', 'WP-CRB-1',
 'cb000000-0000-4000-8000-000000000128', 'cb000000-0000-4000-8000-000000000129',
 'cb000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001');
insert into public.maintenance_due_work (
  id, organization_id, maintenance_plan_id, maintenance_plan_revision_id, original_due_date, due_date,
  window_start_date, window_end_date, status, job_id, created_by, updated_by
) values
('cb000000-0000-4000-8000-000000000133', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000132', 'cb000000-0000-4000-8000-000000000134',
 '2026-11-02', '2026-11-02', '2026-11-02', '2026-11-02', 'visit_created',
 'cb000000-0000-4000-8000-000000000034', 'cb000000-0000-4000-8000-000000000001',
 'cb000000-0000-4000-8000-000000000001');
insert into public.planning_occurrences (id, organization_id, entry_kind, time_kind, job_id, start_at, end_at) values
('cb000000-0000-4000-8000-000000000135', 'cb000000-0000-4000-8000-000000000010', 'job_visit', 'timed',
 'cb000000-0000-4000-8000-000000000034', '2026-11-02 08:00+01', '2026-11-02 12:00+01');
insert into public.planning_occurrence_assignments (organization_id, occurrence_id, employee_record_id)
select 'cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000135', id from suspended_employee;
insert into public.time_accounts (id, organization_id, employee_record_id, opened_on, opened_by)
select 'cb000000-0000-4000-8000-000000000136', 'cb000000-0000-4000-8000-000000000010', id, '2026-01-01',
  'cb000000-0000-4000-8000-000000000001'
from suspended_employee;
insert into public.time_account_adjustment_requests (
  id, organization_id, account_id, employee_record_id, operation_id, request_hash, adjustment_kind,
  minutes, effective_date, reason, requested_by
)
select 'cb000000-0000-4000-8000-000000000137', 'cb000000-0000-4000-8000-000000000010',
  'cb000000-0000-4000-8000-000000000136', id, 'cb000000-0000-4000-8000-000000000138', repeat('a', 64),
  'manual_adjustment', 60, '2026-10-01', 'Ausgleich', 'cb000000-0000-4000-8000-000000000006'
from suspended_employee;
insert into public.time_periods (id, organization_id, period_start_date, period_end_date, prepared_by) values
('cb000000-0000-4000-8000-000000000139', 'cb000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30',
 'cb000000-0000-4000-8000-000000000001');
insert into public.organization_settings (organization_id) values ('cb000000-0000-4000-8000-000000000010')
on conflict do nothing;
insert into public.organization_closure_days (organization_id, closure_date) values
('cb000000-0000-4000-8000-000000000010', '2026-12-24');
insert into public.organization_user_preferences (organization_id, user_id) values
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000006'),
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000007');
insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp) values
('cb000000-0000-4000-8000-000000000140', 'cb000000-0000-4000-8000-000000000007',
 'cb000000-0000-4000-8000-000000000010', 'clock_in', '2026-10-01 07:00+02');
insert into public.entry_change_requests (entry_id, organization_id, requested_by, change_type) values
('cb000000-0000-4000-8000-000000000140', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000007', 'delete');
insert into public.teams (id, organization_id, name) values
('cb000000-0000-4000-8000-000000000141', 'cb000000-0000-4000-8000-000000000010', 'Team Nord');
insert into public.team_memberships (organization_id, team_id, employee_record_id, valid_from)
select 'cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000141', id, '2026-01-01'
from suspended_employee;
insert into public.organization_capabilities (id, organization_id, kind, name, default_expiry_warning_days) values
('cb000000-0000-4000-8000-000000000142', 'cb000000-0000-4000-8000-000000000010', 'skill', 'Löten', 0);
insert into public.employee_capabilities (organization_id, employee_record_id, capability_id, capability_kind, valid_from)
select 'cb000000-0000-4000-8000-000000000010', id, 'cb000000-0000-4000-8000-000000000142', 'skill', '2026-01-01'
from suspended_employee;
set local session_replication_role = origin;

create function pg_temp.visible_families() returns text language sql as $$
  select concat_ws(' ',
    'work=' || (select count(*) from public.jobs where id = 'cb000000-0000-4000-8000-000000000034')
      || (select count(*) from public.projects where id = 'cb000000-0000-4000-8000-000000000022')
      || (select count(*) from public.job_assignments where job_id = 'cb000000-0000-4000-8000-000000000034'),
    'instructions=' || (select count(*) from public.job_instruction_items where id = 'cb000000-0000-4000-8000-000000000120')
      || (select count(*) from public.work_blockers where id = 'cb000000-0000-4000-8000-000000000121'),
    'artifacts=' || (select count(*) from public.work_artifacts where id = 'cb000000-0000-4000-8000-000000000122'),
    'handover=' || (select count(*) from public.work_handover_packages where id = 'cb000000-0000-4000-8000-000000000125'),
    'inventory=' || (select count(*) from public.inventory_items where id = 'cb000000-0000-4000-8000-000000000126')
      || (select count(*) from public.job_material_lines where id = 'cb000000-0000-4000-8000-000000000127'),
    'service=' || (select count(*) from public.service_cases where id = 'cb000000-0000-4000-8000-000000000130')
      || (select count(*) from public.installed_equipment where id = 'cb000000-0000-4000-8000-000000000131'),
    'maintenance=' || (select count(*) from public.maintenance_plans where id = 'cb000000-0000-4000-8000-000000000132')
      || (select count(*) from public.maintenance_due_work where id = 'cb000000-0000-4000-8000-000000000133'),
    'planning=' || (select count(*) from public.planning_occurrences where id = 'cb000000-0000-4000-8000-000000000135'),
    'zeitkonto=' || (select count(*) from public.time_accounts where id = 'cb000000-0000-4000-8000-000000000136')
      || (select count(*) from public.time_account_adjustment_requests where id = 'cb000000-0000-4000-8000-000000000137')
      || (select count(*) from public.time_periods where id = 'cb000000-0000-4000-8000-000000000139'),
    'organization=' || (select count(*) from public.organization_settings
        where organization_id = 'cb000000-0000-4000-8000-000000000010')
      || (select count(*) from public.organization_closure_days
        where organization_id = 'cb000000-0000-4000-8000-000000000010')
      || (select count(*) from public.organization_user_preferences
        where organization_id = 'cb000000-0000-4000-8000-000000000010')
      || (select count(*) from public.entry_change_requests where entry_id = 'cb000000-0000-4000-8000-000000000140')
      || (select count(*) from public.profiles where id = 'cb000000-0000-4000-8000-000000000001'),
    'people=' || (select count(*) from public.teams where id = 'cb000000-0000-4000-8000-000000000141')
      || (select count(*) from public.organization_capabilities where id = 'cb000000-0000-4000-8000-000000000142'),
    'onboarding=' || (select count(*) from public.personnel_access_lifecycles
      where organization_id = 'cb000000-0000-4000-8000-000000000010')
  );
$$;
grant execute on function pg_temp.visible_families() to authenticated;

create function pg_temp.expect_families(p_user uuid, p_expected text) returns void language plpgsql as $$
declare actual text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  actual := pg_temp.visible_families();
  execute 'reset role';
  if actual is distinct from p_expected then
    raise exception 'Visible families for % are "%", expected "%"', p_user, actual, p_expected;
  end if;
end;
$$;

create function pg_temp.set_access(p_user uuid, p_version bigint, p_kind public.personnel_access_transition_kind,
  p_effective_at timestamptz, p_operation uuid) returns void language plpgsql as $$
begin
  execute 'set local role service_role';
  perform public.set_personnel_access_transition(
    'cb000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000010',
    (select id from public.employee_records
      where organization_id = 'cb000000-0000-4000-8000-000000000010' and user_id = p_user),
    p_version, p_kind, p_effective_at, 'Zugang geändert', p_operation, repeat('b', 64)
  );
  execute 'reset role';
end;
$$;

-- Before the suspension: Büro reads every family; the employee reads the
-- assigned work and their own records, no manager-only family.
select pg_temp.expect_families('cb000000-0000-4000-8000-000000000006',
  'work=111 instructions=11 artifacts=1 handover=1 inventory=11 service=11 maintenance=11 planning=1 '
  || 'zeitkonto=111 organization=11111 people=11 onboarding=0');
select pg_temp.expect_families('cb000000-0000-4000-8000-000000000007',
  'work=111 instructions=11 artifacts=1 handover=1 inventory=01 service=00 maintenance=01 planning=1 '
  || 'zeitkonto=110 organization=11101 people=11 onboarding=0');

-- Suspended: nothing, although membership, employee record and assignments stay.
select pg_temp.set_access('cb000000-0000-4000-8000-000000000006', 0, 'suspend_now', clock_timestamp(),
  'cb000000-0000-4000-8000-000000000150');
select pg_temp.set_access('cb000000-0000-4000-8000-000000000007', 0, 'suspend_now', clock_timestamp(),
  'cb000000-0000-4000-8000-000000000151');
select pg_temp.expect_families('cb000000-0000-4000-8000-000000000006',
  'work=000 instructions=00 artifacts=0 handover=0 inventory=00 service=00 maintenance=00 planning=0 '
  || 'zeitkonto=000 organization=00000 people=00 onboarding=0');
select pg_temp.expect_families('cb000000-0000-4000-8000-000000000007',
  'work=000 instructions=00 artifacts=0 handover=0 inventory=00 service=00 maintenance=00 planning=0 '
  || 'zeitkonto=000 organization=00000 people=00 onboarding=0');

-- Prestart (a scheduled reactivation): the employee reads their own onboarding
-- state, but by the owner's decision not their Zeitkonto.
select pg_temp.set_access('cb000000-0000-4000-8000-000000000007', 1, 'schedule_activation',
  clock_timestamp() + interval '1 day', 'cb000000-0000-4000-8000-000000000152');
select pg_temp.expect_families('cb000000-0000-4000-8000-000000000007',
  'work=000 instructions=00 artifacts=0 handover=0 inventory=00 service=00 maintenance=00 planning=0 '
  || 'zeitkonto=000 organization=00000 people=00 onboarding=1');

-- Substitutes. The Büro member names the colleague as substitute for time
-- approval (a selected holder) and for handover review (the role default).
-- The colleague reads through both delegations until the Büro member is
-- suspended; the delegation rows stay.
create temporary table delegation_people as
select
  (select id from public.employee_records where organization_id = 'cb000000-0000-4000-8000-000000000010'
    and user_id = 'cb000000-0000-4000-8000-000000000002') as delegator_id,
  (select id from public.employee_records where organization_id = 'cb000000-0000-4000-8000-000000000010'
    and user_id = 'cb000000-0000-4000-8000-000000000004') as substitute_id;
set local session_replication_role = replica;
update public.organization_responsibility_configurations set effective_from = now() - interval '1 day'
where organization_id = 'cb000000-0000-4000-8000-000000000010';
insert into public.organization_responsibility_configurations (id, organization_id, responsibility, mode) values
('cb000000-0000-4000-8000-000000000160', 'cb000000-0000-4000-8000-000000000010', 'time_approval', 'selected');
insert into public.organization_responsibility_assignments (organization_id, configuration_id, employee_record_id, source)
select 'cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000160', delegator_id, 'direct'
from delegation_people;
insert into public.organization_responsibility_delegations (
  organization_id, responsibility, delegator_employee_record_id, substitute_employee_record_id, valid_from, valid_until
)
select 'cb000000-0000-4000-8000-000000000010', responsibility::public.organization_responsibility, delegator_id,
  substitute_id, current_date - 1, current_date + 1
from delegation_people, (values ('time_approval'), ('work_handover_review')) as delegated(responsibility);
set local session_replication_role = origin;

create function pg_temp.visible_through_delegation() returns text language sql as $$
  select concat_ws(' ',
    'periods=' || (select count(*) from public.time_periods where id = 'cb000000-0000-4000-8000-000000000139'),
    'handover=' || (select count(*) from public.work_handover_packages where id = 'cb000000-0000-4000-8000-000000000125'),
    'configuration=' || (select count(*) from public.organization_responsibility_configurations
      where id = 'cb000000-0000-4000-8000-000000000160')
  );
$$;
grant execute on function pg_temp.visible_through_delegation() to authenticated;

create function pg_temp.expect_delegated(p_expected text) returns void language plpgsql as $$
declare actual text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"cb000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  execute 'set local role authenticated';
  actual := pg_temp.visible_through_delegation();
  execute 'reset role';
  if actual is distinct from p_expected then
    raise exception 'Substitute reads "%", expected "%"', actual, p_expected;
  end if;
end;
$$;

select pg_temp.expect_delegated('periods=1 handover=1 configuration=1');
select pg_temp.set_access('cb000000-0000-4000-8000-000000000002', 0, 'suspend_now', clock_timestamp(),
  'cb000000-0000-4000-8000-000000000153');
select pg_temp.expect_delegated('periods=0 handover=0 configuration=0');

-- Arbeitsnachweis: only artifact roots are client-readable. Defect details
-- must fail at the SQL privilege boundary, even if an RLS policy permits rows.
set local role authenticated;
do $$
begin
  begin
    perform revision_id from public.work_artifact_defect_details;
    raise exception 'authenticated can read Arbeitsnachweis defect details directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role service_role;
do $$
begin
  if (select count(*) from public.work_artifact_defect_details
      where revision_id = 'cb000000-0000-4000-8000-000000000123') <> 1 then
    raise exception 'service_role cannot read Arbeitsnachweis defect details';
  end if;
end;
$$;
reset role;
do $$
declare
  v_granted text[];
begin
  select array_agg(relation.relname::text order by relation.relname collate "C") into v_granted
  from pg_class relation
  where relation.relnamespace = 'public'::regnamespace and relation.relkind = 'r'
    and relation.relname like 'work\_artifact%'
    and has_table_privilege('authenticated', relation.oid, 'SELECT');
  if v_granted is distinct from array['work_artifacts'] then
    raise exception 'authenticated reads the Arbeitsnachweis tables %, expected only the artifacts', v_granted;
  end if;
end;
$$;

rollback;
