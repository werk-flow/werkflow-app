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

rollback;
