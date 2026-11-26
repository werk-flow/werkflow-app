-- The two pending sets of the attention counts (migration 20261016100000):
-- list_pending_dispatch_recipients returns exactly the viewer's recipient rows
-- of a current revision of an active dispatch that the viewer has not
-- acknowledged, and list_handover_candidate_projects exactly the projects
-- without an explicit execution state that have a terminal child job. Both
-- are service-role only. lib/attention/count-volume.test.ts proves the rows
-- read; this file proves the sets the database returns.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('a7e00000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-sets-admin@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Admin","last_name":"Aufgaben"}'::jsonb, now(), now()),
('a7e00000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-sets-employee@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Emil","last_name":"Aufgaben"}'::jsonb, now(), now()),
('a7e00000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-sets-colleague@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Kai","last_name":"Aufgaben"}'::jsonb, now(), now()),
('a7e00000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-sets-outsider@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Fremd","last_name":"Aufgaben"}'::jsonb, now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('a7e00000-0000-4000-8000-000000000010', 'Attention sets',
 'a7e00000-0000-4000-8000-000000000001', 'ATTSETSA'),
('a7e00000-0000-4000-8000-000000000011', 'Other attention sets',
 'a7e00000-0000-4000-8000-000000000004', 'ATTSETSB');
insert into public.organization_members (organization_id, user_id, role) values
('a7e00000-0000-4000-8000-000000000010', 'a7e00000-0000-4000-8000-000000000002', 'employee'),
('a7e00000-0000-4000-8000-000000000010', 'a7e00000-0000-4000-8000-000000000003', 'employee');

-- Six unscheduled jobs, one dispatch each (see the dispatch block below).
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('a7e00000-0000-4000-8000-000000000021', 'a7e00000-0000-4000-8000-000000000010', 'Offen', 'ATT-0001',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000022', 'a7e00000-0000-4000-8000-000000000010', 'Bestätigt', 'ATT-0002',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000023', 'a7e00000-0000-4000-8000-000000000010', 'Rückfrage', 'ATT-0003',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000024', 'a7e00000-0000-4000-8000-000000000010', 'Geklärt', 'ATT-0004',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000025', 'a7e00000-0000-4000-8000-000000000010', 'Storniert', 'ATT-0005',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000026', 'a7e00000-0000-4000-8000-000000000010', 'Kollege', 'ATT-0006',
 'a7e00000-0000-4000-8000-000000000001');

-- Handover: P1 complete by a finished child, P2 handed over, P3 still running,
-- P4 complete by a legacy child (no execution state, status fertig), P5 by a
-- cancelled child; P6 belongs to another organization.
insert into public.projects (id, organization_id, name, project_number, created_by) values
('a7e00000-0000-4000-8000-000000000041', 'a7e00000-0000-4000-8000-000000000010', 'Fertig', 'ATT-P-1',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000042', 'a7e00000-0000-4000-8000-000000000010', 'Übergeben', 'ATT-P-2',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000043', 'a7e00000-0000-4000-8000-000000000010', 'Läuft', 'ATT-P-3',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000044', 'a7e00000-0000-4000-8000-000000000010', 'Altbestand', 'ATT-P-4',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000045', 'a7e00000-0000-4000-8000-000000000010', 'Storniert', 'ATT-P-5',
 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000046', 'a7e00000-0000-4000-8000-000000000011', 'Fremd', 'ATT-P-6',
 'a7e00000-0000-4000-8000-000000000004');
insert into public.jobs (id, organization_id, project_id, title, job_number, created_by) values
('a7e00000-0000-4000-8000-000000000051', 'a7e00000-0000-4000-8000-000000000010',
 'a7e00000-0000-4000-8000-000000000041', 'P1 Kind', 'ATT-0011', 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000052', 'a7e00000-0000-4000-8000-000000000010',
 'a7e00000-0000-4000-8000-000000000042', 'P2 Kind', 'ATT-0012', 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000053', 'a7e00000-0000-4000-8000-000000000010',
 'a7e00000-0000-4000-8000-000000000043', 'P3 Kind', 'ATT-0013', 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000054', 'a7e00000-0000-4000-8000-000000000010',
 'a7e00000-0000-4000-8000-000000000044', 'P4 Kind', 'ATT-0014', 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000055', 'a7e00000-0000-4000-8000-000000000010',
 'a7e00000-0000-4000-8000-000000000045', 'P5 Kind', 'ATT-0015', 'a7e00000-0000-4000-8000-000000000001'),
('a7e00000-0000-4000-8000-000000000056', 'a7e00000-0000-4000-8000-000000000011',
 'a7e00000-0000-4000-8000-000000000046', 'P6 Kind', 'ATT-0016', 'a7e00000-0000-4000-8000-000000000004');
-- The execution guard admits one flagged row per statement, as the owning RPCs write.
create function pg_temp.set_execution(target uuid, state public.work_execution_state, legacy public.job_status)
returns void language plpgsql as $$
begin
  perform set_config('app.work_execution_write', 'true', true);
  update public.jobs set execution_state = state, status = coalesce(legacy, status) where id = target;
end;
$$;
select pg_temp.set_execution('a7e00000-0000-4000-8000-000000000051', 'execution_complete', 'fertig');
select pg_temp.set_execution('a7e00000-0000-4000-8000-000000000056', 'execution_complete', 'fertig');
select pg_temp.set_execution('a7e00000-0000-4000-8000-000000000052', 'handed_over', 'fertig');
select pg_temp.set_execution('a7e00000-0000-4000-8000-000000000053', 'in_progress', 'in_bearbeitung');
select pg_temp.set_execution('a7e00000-0000-4000-8000-000000000055', 'cancelled', null);
-- A legacy child: no execution state, finished by its status alone.
select pg_temp.set_execution('a7e00000-0000-4000-8000-000000000054', null, 'fertig');
select set_config('app.work_execution_write', 'true', true);
update public.projects set execution_state_override = 'handed_over'
where id = 'a7e00000-0000-4000-8000-000000000042';

-- Browser and anonymous roles never execute either function.
do $$
begin
  if has_function_privilege('authenticated', 'public.list_pending_dispatch_recipients(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.list_pending_dispatch_recipients(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.list_handover_candidate_projects(uuid)', 'execute')
     or has_function_privilege('anon', 'public.list_handover_candidate_projects(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.list_pending_dispatch_recipients(uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.list_handover_candidate_projects(uuid)', 'execute')
    then raise exception 'the pending-set functions are not service-role only'; end if;
end;
$$;

set local role service_role;

do $$
declare
  org constant uuid := 'a7e00000-0000-4000-8000-000000000010';
  admin_user constant uuid := 'a7e00000-0000-4000-8000-000000000001';
  employee_user constant uuid := 'a7e00000-0000-4000-8000-000000000002';
  colleague_user constant uuid := 'a7e00000-0000-4000-8000-000000000003';
  employee_record uuid;
  colleague_record uuid;
  open_dispatch uuid;
  acknowledged_dispatch uuid;
  challenged_dispatch uuid;
  resolved_dispatch uuid;
  cancelled_dispatch uuid;
  colleague_dispatch uuid;
  challenge_id uuid;
  expected uuid[];
  actual uuid[];
begin
  select id into employee_record from public.employee_records where organization_id = org and user_id = employee_user;
  select id into colleague_record from public.employee_records where organization_id = org and user_id = colleague_user;
  if employee_record is null or colleague_record is null then raise exception 'employee record prerequisite missing'; end if;

  open_dispatch := public.issue_planning_dispatch(
    p_organization_id => org, p_actor_id => admin_user, p_job_id => 'a7e00000-0000-4000-8000-000000000021',
    p_recipient_employee_record_ids => array[employee_record], p_readiness_snapshot => '{}'::jsonb,
    p_readiness_fingerprint => repeat('a', 64), p_request_id => 'a7e00000-0000-4000-8000-000000000031');
  acknowledged_dispatch := public.issue_planning_dispatch(
    p_organization_id => org, p_actor_id => admin_user, p_job_id => 'a7e00000-0000-4000-8000-000000000022',
    p_recipient_employee_record_ids => array[employee_record], p_readiness_snapshot => '{}'::jsonb,
    p_readiness_fingerprint => repeat('a', 64), p_request_id => 'a7e00000-0000-4000-8000-000000000032');
  challenged_dispatch := public.issue_planning_dispatch(
    p_organization_id => org, p_actor_id => admin_user, p_job_id => 'a7e00000-0000-4000-8000-000000000023',
    p_recipient_employee_record_ids => array[employee_record], p_readiness_snapshot => '{}'::jsonb,
    p_readiness_fingerprint => repeat('a', 64), p_request_id => 'a7e00000-0000-4000-8000-000000000033');
  resolved_dispatch := public.issue_planning_dispatch(
    p_organization_id => org, p_actor_id => admin_user, p_job_id => 'a7e00000-0000-4000-8000-000000000024',
    p_recipient_employee_record_ids => array[employee_record], p_readiness_snapshot => '{}'::jsonb,
    p_readiness_fingerprint => repeat('a', 64), p_request_id => 'a7e00000-0000-4000-8000-000000000034');
  cancelled_dispatch := public.issue_planning_dispatch(
    p_organization_id => org, p_actor_id => admin_user, p_job_id => 'a7e00000-0000-4000-8000-000000000025',
    p_recipient_employee_record_ids => array[employee_record], p_readiness_snapshot => '{}'::jsonb,
    p_readiness_fingerprint => repeat('a', 64), p_request_id => 'a7e00000-0000-4000-8000-000000000035');
  colleague_dispatch := public.issue_planning_dispatch(
    p_organization_id => org, p_actor_id => admin_user, p_job_id => 'a7e00000-0000-4000-8000-000000000026',
    p_recipient_employee_record_ids => array[colleague_record], p_readiness_snapshot => '{}'::jsonb,
    p_readiness_fingerprint => repeat('a', 64), p_request_id => 'a7e00000-0000-4000-8000-000000000036');

  perform public.acknowledge_planning_dispatch(
    p_organization_id => org, p_actor_id => employee_user, p_dispatch_id => acknowledged_dispatch,
    p_expected_revision_number => 1);
  perform public.challenge_planning_dispatch(
    p_organization_id => org, p_actor_id => employee_user, p_dispatch_id => challenged_dispatch,
    p_expected_revision_number => 1, p_reason => 'Termin passt nicht');
  perform public.challenge_planning_dispatch(
    p_organization_id => org, p_actor_id => employee_user, p_dispatch_id => resolved_dispatch,
    p_expected_revision_number => 1, p_reason => 'Material fehlt');
  select id into challenge_id from public.planning_dispatch_acknowledgements
  where dispatch_id = resolved_dispatch and state = 'challenged';
  perform public.resolve_planning_dispatch_challenge(
    p_organization_id => org, p_actor_id => admin_user, p_acknowledgement_id => challenge_id,
    p_resolution_reason => 'Material liegt bereit');
  perform public.cancel_planning_dispatch(
    p_organization_id => org, p_actor_id => admin_user, p_dispatch_id => cancelled_dispatch,
    p_reason => 'Auftrag entfällt');

  -- The TypeScript derivation (deriveRecipientState) turns these rows into tasks:
  -- no acknowledgement and a resolved challenge are pending, an open challenge
  -- is a question. An acknowledged, a cancelled and a colleague's dispatch never
  -- reached a task, so the database leaves them out.
  expected := array[open_dispatch, challenged_dispatch, resolved_dispatch];
  select array_agg(dispatch_id order by dispatch_id) into actual
  from public.list_pending_dispatch_recipients(org, employee_record);
  if actual is distinct from (select array_agg(id order by id) from unnest(expected) id)
    then raise exception 'pending dispatch recipients: expected %, got %', expected, actual; end if;
  if exists (
    select 1 from public.list_pending_dispatch_recipients(org, employee_record) pending
    join public.planning_dispatches dispatch on dispatch.id = pending.dispatch_id
    where dispatch.current_revision_id <> pending.revision_id
  ) then raise exception 'a pending recipient row is not of the current revision'; end if;
  if (select count(*) from public.list_pending_dispatch_recipients(org, colleague_record)) <> 1
    then raise exception 'the colleague does not see exactly the own dispatch'; end if;
  if exists (select 1 from public.list_pending_dispatch_recipients('a7e00000-0000-4000-8000-000000000011', employee_record))
    then raise exception 'another organization returned the viewer''s dispatches'; end if;

  select array_agg(project_id order by project_id) into actual
  from public.list_handover_candidate_projects(org);
  if actual is distinct from array[
    'a7e00000-0000-4000-8000-000000000041', 'a7e00000-0000-4000-8000-000000000044',
    'a7e00000-0000-4000-8000-000000000045'
  ]::uuid[] then raise exception 'handover candidates: got %', actual; end if;
end;
$$;

reset role;

-- Part two, with organizations of its own: the overdue job set.
-- The overdue job set of the office's attention read (migration
-- 20261231090000): read_manager_attention_sets returns as overdue_jobs exactly
-- the open jobs of the organization whose every scheduled visit has ended, with
-- the end of the last timed and the last all-day visit. Parked, finished,
-- cancelled, never-visited and another organization's jobs never appear, and
-- the set stops at its limit plus one. lib/attention/job-tasks.test.ts proves
-- the Berlin-day rule the TypeScript applies to overdue_jobs.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('a7f00000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'job-sets-admin@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
('a7f00000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'job-sets-employee@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Max","last_name":"Mustermann"}'::jsonb, now(), now()),
('a7f00000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'job-sets-outsider@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Fremd","last_name":"Firma"}'::jsonb, now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('a7f00000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 'a7f00000-0000-4000-8000-000000000001', 'JOBSETSA'),
('a7f00000-0000-4000-8000-000000000011', 'Hausverwaltung Lindenhof GmbH',
 'a7f00000-0000-4000-8000-000000000003', 'JOBSETSB');
insert into public.organization_members (organization_id, user_id, role) values
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000002', 'employee');

insert into public.projects (id, organization_id, name, project_number, created_by) values
('a7f00000-0000-4000-8000-000000000040', 'a7f00000-0000-4000-8000-000000000010', 'Neubau Lindenstraße',
 'JS-P-1', 'a7f00000-0000-4000-8000-000000000001');

-- Created in number order, so the oldest-first order is the number order.
insert into public.jobs (id, organization_id, title, job_number, status, project_id, created_by, created_at)
select id::uuid, organization_id::uuid, title, job_number, status::public.job_status, project_id::uuid,
  'a7f00000-0000-4000-8000-000000000001', '2026-10-01T08:00:00Z'::timestamptz + n * interval '1 hour'
from (values
  (1, 'a7f00000-0000-4000-8000-000000000021', 'a7f00000-0000-4000-8000-000000000010', 'Ohne alles', 'JS-01', 'nicht_bearbeitet', null),
  (2, 'a7f00000-0000-4000-8000-000000000022', 'a7f00000-0000-4000-8000-000000000010', 'Zugewiesen', 'JS-02', 'nicht_bearbeitet', null),
  (3, 'a7f00000-0000-4000-8000-000000000023', 'a7f00000-0000-4000-8000-000000000010', 'Nur abgesagt', 'JS-03', 'nicht_bearbeitet', null),
  (4, 'a7f00000-0000-4000-8000-000000000024', 'a7f00000-0000-4000-8000-000000000010', 'Geparkt', 'JS-04', 'geparkt', null),
  (5, 'a7f00000-0000-4000-8000-000000000025', 'a7f00000-0000-4000-8000-000000000010', 'Fertig', 'JS-05', 'fertig', null),
  (6, 'a7f00000-0000-4000-8000-000000000026', 'a7f00000-0000-4000-8000-000000000010', 'Gestern besucht', 'JS-06', 'nicht_bearbeitet', null),
  (7, 'a7f00000-0000-4000-8000-000000000027', 'a7f00000-0000-4000-8000-000000000010', 'Nächster Termin folgt', 'JS-07', 'in_bearbeitung', null),
  (8, 'a7f00000-0000-4000-8000-000000000028', 'a7f00000-0000-4000-8000-000000000010', 'Ganztägig vorbei', 'JS-08', 'in_bearbeitung', null),
  (9, 'a7f00000-0000-4000-8000-000000000029', 'a7f00000-0000-4000-8000-000000000010', 'Ganztägig heute', 'JS-09', 'nicht_bearbeitet', null),
  (10, 'a7f00000-0000-4000-8000-000000000030', 'a7f00000-0000-4000-8000-000000000010', 'Im Projekt', 'JS-10', 'nicht_bearbeitet', 'a7f00000-0000-4000-8000-000000000040'),
  (11, 'a7f00000-0000-4000-8000-000000000031', 'a7f00000-0000-4000-8000-000000000010', 'Fertig nach Besuch', 'JS-11', 'fertig', null),
  (12, 'a7f00000-0000-4000-8000-000000000032', 'a7f00000-0000-4000-8000-000000000011', 'Fremd', 'JS-12', 'nicht_bearbeitet', null),
  (13, 'a7f00000-0000-4000-8000-000000000033', 'a7f00000-0000-4000-8000-000000000011', 'Fremd besucht', 'JS-13', 'nicht_bearbeitet', null),
  (14, 'a7f00000-0000-4000-8000-000000000034', 'a7f00000-0000-4000-8000-000000000010', 'Storniert ohne alles', 'JS-14', 'nicht_bearbeitet', null),
  (15, 'a7f00000-0000-4000-8000-000000000035', 'a7f00000-0000-4000-8000-000000000010', 'Storniert nach Besuch', 'JS-15', 'in_bearbeitung', null)
) as job(n, id, organization_id, title, job_number, status, project_id);

-- Cancelling keeps the job's status (preserve_job_legacy_status_on_cancellation): only its state says so.
-- The execution guard admits one flagged row per statement, as the owning RPCs write.
select set_config('app.work_execution_write', 'true', true);
update public.jobs set execution_state = 'cancelled' where id = 'a7f00000-0000-4000-8000-000000000034';
select set_config('app.work_execution_write', 'true', true);
update public.jobs set execution_state = 'cancelled' where id = 'a7f00000-0000-4000-8000-000000000035';
do $$
begin
  if exists (
    select 1 from public.jobs
    where id in ('a7f00000-0000-4000-8000-000000000034', 'a7f00000-0000-4000-8000-000000000035')
      and status not in ('nicht_bearbeitet', 'in_bearbeitung')
  ) then raise exception 'the fixture expects a cancelled job to keep its open status'; end if;
end;
$$;

insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000022',
 'a7f00000-0000-4000-8000-000000000002', 'a7f00000-0000-4000-8000-000000000001');

insert into public.planning_occurrences (organization_id, job_id, entry_kind, time_kind, status, start_at, end_at) values
-- Only a cancelled visit: no scheduled visit, so not overdue.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000023', 'job_visit', 'timed', 'cancelled',
 now() + interval '1 day', now() + interval '1 day 2 hours'),
-- Every visit over: the last one ended a day ago.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000026', 'job_visit', 'timed', 'scheduled',
 now() - interval '3 days 2 hours', now() - interval '3 days'),
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000026', 'job_visit', 'timed', 'scheduled',
 now() - interval '1 day 2 hours', now() - interval '1 day'),
-- A past visit and one still ahead: not overdue.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000027', 'job_visit', 'timed', 'scheduled',
 now() - interval '5 days 2 hours', now() - interval '5 days'),
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000027', 'job_visit', 'timed', 'scheduled',
 now() + interval '2 days', now() + interval '2 days 2 hours'),
-- A job of a project whose visit is over.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000030', 'job_visit', 'timed', 'scheduled',
 now() - interval '2 days 2 hours', now() - interval '2 days'),
-- A cancelled job's past visit.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000035', 'job_visit', 'timed', 'scheduled',
 now() - interval '4 days 2 hours', now() - interval '4 days'),
-- A finished job's past visit, and another organization's.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000031', 'job_visit', 'timed', 'scheduled',
 now() - interval '4 days 2 hours', now() - interval '4 days'),
('a7f00000-0000-4000-8000-000000000011', 'a7f00000-0000-4000-8000-000000000033', 'job_visit', 'timed', 'scheduled',
 now() - interval '4 days 2 hours', now() - interval '4 days');
insert into public.planning_occurrences (organization_id, job_id, entry_kind, time_kind, status, start_date, end_date_exclusive) values
-- An all-day visit that ended yesterday in Berlin, and one that runs through today.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000028', 'job_visit', 'all_day', 'scheduled',
 (now() at time zone 'Europe/Berlin')::date - 2, (now() at time zone 'Europe/Berlin')::date),
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000029', 'job_visit', 'all_day', 'scheduled',
 (now() at time zone 'Europe/Berlin')::date - 1, (now() at time zone 'Europe/Berlin')::date + 1);

set local role service_role;

do $$
declare
  sets jsonb := public.read_manager_attention_sets('a7f00000-0000-4000-8000-000000000010', 100);
  overdue text[];
  last_timed timestamptz;
  last_all_day date;
begin
  select array_agg(job.value ->> 'job_number' order by job.ordinality) into overdue
  from jsonb_array_elements(sets -> 'overdue_jobs') with ordinality as job(value, ordinality);
  if overdue is distinct from array['JS-06', 'JS-08', 'JS-10'] then
    raise exception 'overdue jobs: expected JS-06, JS-08, JS-10, got %', overdue;
  end if;
  if (sets -> 'overdue_jobs' -> 2 ->> 'project_number') is distinct from 'JS-P-1'
    or (sets -> 'overdue_jobs' -> 2 ->> 'project_id') is distinct from 'a7f00000-0000-4000-8000-000000000040'
    or (sets -> 'overdue_jobs' -> 0 ->> 'project_id') is not null
  then raise exception 'an overdue job names its project wrongly: %', sets -> 'overdue_jobs'; end if;
  last_timed := (sets -> 'overdue_jobs' -> 0 ->> 'last_timed_end')::timestamptz;
  if last_timed is null or abs(extract(epoch from (now() - interval '1 day') - last_timed)) > 1
    or (sets -> 'overdue_jobs' -> 0 ->> 'last_all_day_end') is not null
  then raise exception 'the overdue timed job carries the wrong last end: %', sets -> 'overdue_jobs' -> 0; end if;
  last_all_day := (sets -> 'overdue_jobs' -> 1 ->> 'last_all_day_end')::date;
  if last_all_day is distinct from (now() at time zone 'Europe/Berlin')::date
    or (sets -> 'overdue_jobs' -> 1 ->> 'last_timed_end') is not null
  then raise exception 'the overdue all-day job carries the wrong last end: %', sets -> 'overdue_jobs' -> 1; end if;
end;
$$;

do $$
declare
  other jsonb := public.read_manager_attention_sets('a7f00000-0000-4000-8000-000000000011', 100);
  capped jsonb := public.read_manager_attention_sets('a7f00000-0000-4000-8000-000000000010', 0);
begin
  if jsonb_array_length(other -> 'overdue_jobs') is distinct from 1
    or (other -> 'overdue_jobs' -> 0 ->> 'job_number') is distinct from 'JS-13'
  then raise exception 'the overdue job set crosses the organization: %', other; end if;
  if jsonb_array_length(capped -> 'overdue_jobs') is distinct from 1
  then raise exception 'the overdue job set cuts below its limit plus one: %', capped; end if;
end;
$$;

reset role;

do $$
begin
  if has_function_privilege('authenticated', 'public.read_manager_attention_sets(uuid,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.read_manager_attention_sets(uuid,integer)', 'EXECUTE')
  then raise exception 'a browser role can read the office''s attention sets'; end if;
end;
$$;

-- Part three, with organizations of its own: the due maintenance set.
-- The due maintenance set of the office's attention read (migration
-- 20270415090000_hold_due_maintenance_in_aufgaben.sql):
-- read_manager_attention_sets returns as due_maintenance exactly the open due
-- items of the organization, without a visit job, whose due date lies at most
-- 14 days after today in Berlin, earliest due first. Each names its plan
-- number, its plan's Einsatzort and the Anlagen of its own revision that are
-- neither archived nor voided, by name. An item with a visit job, a completed,
-- skipped, cancelled or superseded item, one due on the 15th day and another
-- organization's item never appear, and the set stops at its limit plus one.
-- lib/maintenance/overdue.test.ts proves the same window in TypeScript.

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('51800000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','due-sets-admin@example.test','',now(),'{}','{"first_name":"Erika","last_name":"Musterfrau"}',now(),now()),
('51800000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','due-sets-outsider@example.test','',now(),'{}','{"first_name":"Fremd","last_name":"Firma"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('51800000-0000-4000-8000-000000000010','Haustechnik Sonnenberg GmbH','51800000-0000-4000-8000-000000000001','DUESETSA'),
('51800000-0000-4000-8000-000000000011','Hausverwaltung Lindenhof GmbH','51800000-0000-4000-8000-000000000003','DUESETSB');
insert into public.clients(id,organization_id,name) values
('51800000-0000-4000-8000-000000000020','51800000-0000-4000-8000-000000000010','Erika Musterfrau'),
('51800000-0000-4000-8000-000000000021','51800000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('51800000-0000-4000-8000-000000000030','51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000020','Heizzentrale Lindenhof',true,'51800000-0000-4000-8000-000000000001'),
('51800000-0000-4000-8000-000000000031','51800000-0000-4000-8000-000000000011','51800000-0000-4000-8000-000000000021','Fremdort',true,'51800000-0000-4000-8000-000000000003');
insert into public.jobs(id,organization_id,created_by,client_id,site_id,job_number,title) values
('51800000-0000-4000-8000-000000000040','51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000001','51800000-0000-4000-8000-000000000020','51800000-0000-4000-8000-000000000030','AUF-DUE-1','Wartungsbesuch');
-- Maintenance rows are written only through their RPCs; the seed bypasses the
-- write guards and validation triggers, so every reference is set by hand.
set local session_replication_role = replica;
insert into public.installed_equipment(id,organization_id,client_id,site_id,predecessor_equipment_id,equipment_number,name,category,state,archived_at,archived_by,archive_reason,voided_at,voided_by,void_reason,created_by,updated_by) values
('51800000-0000-4000-8000-000000000050','51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000020','51800000-0000-4000-8000-000000000030',null,'ANL-DUE-1','Gasbrennwertkessel','heat_generation','active',null,null,null,null,null,null,'51800000-0000-4000-8000-000000000001','51800000-0000-4000-8000-000000000001'),
('51800000-0000-4000-8000-000000000051','51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000020','51800000-0000-4000-8000-000000000030',null,'ANL-DUE-2','Enthärtungsanlage','heat_generation','active',null,null,null,null,null,null,'51800000-0000-4000-8000-000000000001','51800000-0000-4000-8000-000000000001'),
('51800000-0000-4000-8000-000000000052','51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000020','51800000-0000-4000-8000-000000000030',null,'ANL-DUE-3','Alter Speicher','heat_generation','removed',now(),'51800000-0000-4000-8000-000000000001','Ausgebaut',null,null,null,'51800000-0000-4000-8000-000000000001','51800000-0000-4000-8000-000000000001'),
('51800000-0000-4000-8000-000000000053','51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000020','51800000-0000-4000-8000-000000000030','51800000-0000-4000-8000-000000000050','ANL-DUE-4','Falsch erfasst','heat_generation','active',null,null,null,now(),'51800000-0000-4000-8000-000000000001','Falsch erfasst','51800000-0000-4000-8000-000000000001','51800000-0000-4000-8000-000000000001');
insert into public.work_templates(id,organization_id,target_type) values
('51800000-0000-4000-8000-000000000055','51800000-0000-4000-8000-000000000010','job'),
('51800000-0000-4000-8000-000000000056','51800000-0000-4000-8000-000000000011','job');
insert into public.work_template_versions(id,organization_id,template_id,version_number,name) values
('51800000-0000-4000-8000-000000000057','51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000055',1,'Heizungswartung'),
('51800000-0000-4000-8000-000000000058','51800000-0000-4000-8000-000000000011','51800000-0000-4000-8000-000000000056',1,'Fremdwartung');
-- Plan A covers the four Anlagen in revision 1; plan B of the other organization.
insert into public.maintenance_plans(id,organization_id,plan_number,client_id,site_id,status,current_revision_id,created_by,updated_by) values
('51800000-0000-4000-8000-000000000060','51800000-0000-4000-8000-000000000010','WPL-DUE-A','51800000-0000-4000-8000-000000000020','51800000-0000-4000-8000-000000000030','active','51800000-0000-4000-8000-000000000061','51800000-0000-4000-8000-000000000001','51800000-0000-4000-8000-000000000001'),
('51800000-0000-4000-8000-000000000062','51800000-0000-4000-8000-000000000011','WPL-DUE-B','51800000-0000-4000-8000-000000000021','51800000-0000-4000-8000-000000000031','active','51800000-0000-4000-8000-000000000063','51800000-0000-4000-8000-000000000003','51800000-0000-4000-8000-000000000003');
insert into public.maintenance_plan_revisions(id,organization_id,maintenance_plan_id,revision_number,template_version_id,effective_from_date,first_due_date,interval_months,planned_duration_minutes,next_due_basis,reason,created_by) values
('51800000-0000-4000-8000-000000000061','51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000060',1,'51800000-0000-4000-8000-000000000057','2026-01-01','2026-01-10',1,120,'planned_due_date','Erstanlage','51800000-0000-4000-8000-000000000001'),
('51800000-0000-4000-8000-000000000063','51800000-0000-4000-8000-000000000011','51800000-0000-4000-8000-000000000062',1,'51800000-0000-4000-8000-000000000058','2026-01-01','2026-01-10',1,120,'planned_due_date','Erstanlage','51800000-0000-4000-8000-000000000003');
insert into public.maintenance_plan_revision_equipment(organization_id,maintenance_plan_revision_id,equipment_id,created_by)
select '51800000-0000-4000-8000-000000000010','51800000-0000-4000-8000-000000000061', equipment_id::uuid,'51800000-0000-4000-8000-000000000001'
from unnest(array['51800000-0000-4000-8000-000000000050','51800000-0000-4000-8000-000000000051',
  '51800000-0000-4000-8000-000000000052','51800000-0000-4000-8000-000000000053']) as equipment_id;
-- Due days count from today in Berlin: D1 overdue, D2 today, D3 the 14th day,
-- D4 the 15th day, D5 overdue with a visit job, D6 to D9 settled, DB foreign.
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,job_id,scope_outcome,completed_on,exception_reason,created_by,updated_by)
select id::uuid, organization_id::uuid, plan_id::uuid, revision_id::uuid, today + offset_days, today + offset_days,
  today + offset_days - 10, today + offset_days + 10, status::public.maintenance_due_status, job_id::uuid,
  scope_outcome::public.maintenance_scope_outcome,
  case when status = 'completed' then today + offset_days end,
  case when status in ('skipped', 'cancelled', 'superseded') then 'Ausnahme erfasst' end,
  creator::uuid, creator::uuid
from (select (now() at time zone 'Europe/Berlin')::date as today) berlin,
(values
  ('51800000-0000-4000-8000-000000000071', -30, 'open', null, null),
  ('51800000-0000-4000-8000-000000000072', 0, 'open', null, null),
  ('51800000-0000-4000-8000-000000000073', 14, 'open', null, null),
  ('51800000-0000-4000-8000-000000000074', 15, 'open', null, null),
  ('51800000-0000-4000-8000-000000000075', -5, 'visit_created', '51800000-0000-4000-8000-000000000040', null),
  ('51800000-0000-4000-8000-000000000076', -60, 'completed', '51800000-0000-4000-8000-000000000040', 'complete'),
  ('51800000-0000-4000-8000-000000000077', -3, 'skipped', null, null),
  ('51800000-0000-4000-8000-000000000078', 2, 'cancelled', null, null),
  ('51800000-0000-4000-8000-000000000079', 3, 'superseded', null, null)
) as due_a(id, offset_days, status, job_id, scope_outcome),
lateral (select '51800000-0000-4000-8000-000000000010' as organization_id,
  '51800000-0000-4000-8000-000000000060' as plan_id, '51800000-0000-4000-8000-000000000061' as revision_id,
  '51800000-0000-4000-8000-000000000001' as creator) plan_a
union all
select '51800000-0000-4000-8000-000000000080'::uuid, '51800000-0000-4000-8000-000000000011'::uuid,
  '51800000-0000-4000-8000-000000000062'::uuid, '51800000-0000-4000-8000-000000000063'::uuid,
  today - 1, today - 1, today - 11, today + 9, 'open', null, null, null, null,
  '51800000-0000-4000-8000-000000000003'::uuid, '51800000-0000-4000-8000-000000000003'::uuid
from (select (now() at time zone 'Europe/Berlin')::date as today) berlin;
set local session_replication_role = origin;

set local role service_role;

do $$
declare
  today constant date := (now() at time zone 'Europe/Berlin')::date;
  sets jsonb := public.read_manager_attention_sets('51800000-0000-4000-8000-000000000010', 100);
  due_ids text[];
  first_item jsonb;
begin
  select array_agg(item.value ->> 'id' order by item.ordinality) into due_ids
  from jsonb_array_elements(sets -> 'due_maintenance') with ordinality as item(value, ordinality);
  if due_ids is distinct from array['51800000-0000-4000-8000-000000000071',
    '51800000-0000-4000-8000-000000000072', '51800000-0000-4000-8000-000000000073'] then
    raise exception 'due maintenance: expected the overdue item, the one due today and the one due on the 14th day, earliest first, got %', due_ids;
  end if;
  first_item := sets -> 'due_maintenance' -> 0;
  if (first_item ->> 'due_date')::date is distinct from today - 30
    or (first_item ->> 'plan_number') is distinct from 'WPL-DUE-A'
    or (first_item ->> 'site_name') is distinct from 'Heizzentrale Lindenhof'
  then raise exception 'a due item names its date, plan or Einsatzort wrongly: %', first_item; end if;
  if (first_item -> 'equipment_names') is distinct from '["Enthärtungsanlage", "Gasbrennwertkessel"]'::jsonb
  then raise exception 'a due item names other than its revision''s current Anlagen by name: %', first_item -> 'equipment_names'; end if;
  if (sets -> 'requests') is null or (sets -> 'access_proposals') is null or (sets -> 'overdue_jobs') is null
  then raise exception 'the office''s other sets left the read: %', sets; end if;
end;
$$;

do $$
declare
  other jsonb := public.read_manager_attention_sets('51800000-0000-4000-8000-000000000011', 100);
  capped jsonb := public.read_manager_attention_sets('51800000-0000-4000-8000-000000000010', 0);
begin
  if jsonb_array_length(other -> 'due_maintenance') is distinct from 1
    or (other -> 'due_maintenance' -> 0 ->> 'plan_number') is distinct from 'WPL-DUE-B'
    or (other -> 'due_maintenance' -> 0 -> 'equipment_names') is distinct from '[]'::jsonb
  then raise exception 'the due maintenance set crosses the organization: %', other -> 'due_maintenance'; end if;
  if jsonb_array_length(capped -> 'due_maintenance') is distinct from 1
  then raise exception 'the due maintenance set cuts below its limit plus one: %', capped -> 'due_maintenance'; end if;
end;
$$;

reset role;

rollback;
