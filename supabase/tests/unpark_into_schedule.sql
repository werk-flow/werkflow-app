-- Unparking a job into the schedule applies completely or not at all
-- (migration 20261004170300_unpark_jobs_into_schedule_atomically.sql). A
-- refused schedule step leaves the job parked with its open blocker, a job of
-- another organization is refused, the unpark decides the status, the visit is
-- planned for the whole selection (migration
-- 20261005110000_plan_unparked_visit_for_selection.sql), and only the service
-- role executes the function.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('26104170-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'unpark-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Unpark"}', now(), now()),
('26104170-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'unpark-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Unpark"}', now(), now()),
('26104170-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'unpark-foreign@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"Unpark"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('26104170-0000-0000-0000-000000000010', 'Unpark SQL',
  '26104170-0000-0000-0000-000000000001', 'UNPARKSQ'),
('26104170-0000-0000-0000-000000000011', 'Foreign unpark SQL',
  '26104170-0000-0000-0000-000000000003', 'UNPARKFO');
insert into public.organization_members (organization_id, user_id, role) values
('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000002', 'employee');

-- Job 050 is a parked job without an execution state, job 051 was parked in
-- progress, job 059 belongs to the other organization.
insert into public.jobs (id, organization_id, job_number, title, status, execution_state, created_by)
values
('26104170-0000-0000-0000-000000000050', '26104170-0000-0000-0000-000000000010',
  'UNPARK-J-1', 'Wartung', 'nicht_bearbeitet', null, '26104170-0000-0000-0000-000000000001'),
('26104170-0000-0000-0000-000000000051', '26104170-0000-0000-0000-000000000010',
  'UNPARK-J-2', 'Rohinstallation', 'in_bearbeitung', 'in_progress', '26104170-0000-0000-0000-000000000001'),
('26104170-0000-0000-0000-000000000059', '26104170-0000-0000-0000-000000000011',
  'UNPARK-J-9', 'Fremder Auftrag', 'nicht_bearbeitet', null, '26104170-0000-0000-0000-000000000003');

-- Job 052 is planned for the admin and the employee. A calendar move then took
-- the employee off the visit and left them on the job.
insert into public.jobs (
  id, organization_id, job_number, title, status, execution_state, planned_date, planned_time, created_by
) values
('26104170-0000-0000-0000-000000000052', '26104170-0000-0000-0000-000000000010',
  'UNPARK-J-3', 'Heizungstausch', 'nicht_bearbeitet', null, '2026-11-01', '08:00:00',
  '26104170-0000-0000-0000-000000000001');
insert into public.job_assignments (job_id, user_id, assigned_by) values
('26104170-0000-0000-0000-000000000052', '26104170-0000-0000-0000-000000000001',
  '26104170-0000-0000-0000-000000000001'),
('26104170-0000-0000-0000-000000000052', '26104170-0000-0000-0000-000000000002',
  '26104170-0000-0000-0000-000000000001');
delete from public.planning_occurrence_assignments assignment
using public.planning_occurrences occurrence, public.employee_records employee
where occurrence.id = assignment.occurrence_id
  and occurrence.legacy_source_job_id = '26104170-0000-0000-0000-000000000052'
  and employee.id = assignment.employee_record_id
  and employee.user_id = '26104170-0000-0000-0000-000000000002';

do $$
declare
  v_job uuid;
  v_responsible uuid;
begin
  if (select count(*) from public.planning_occurrence_assignments assignment
      join public.planning_occurrences occurrence on occurrence.id = assignment.occurrence_id
      where occurrence.legacy_source_job_id = '26104170-0000-0000-0000-000000000052') <> 1
  then raise exception 'the fixture visit is not planned for the admin alone'; end if;
  select id into v_responsible from public.employee_records
  where organization_id = '26104170-0000-0000-0000-000000000010'
    and user_id = '26104170-0000-0000-0000-000000000001';
  foreach v_job in array array[
    '26104170-0000-0000-0000-000000000050'::uuid, '26104170-0000-0000-0000-000000000051'::uuid,
    '26104170-0000-0000-0000-000000000052'::uuid
  ] loop
    perform public.park_work_target('26104170-0000-0000-0000-000000000010',
      '26104170-0000-0000-0000-000000000001', 'job', v_job, 0, 'material', null,
      v_responsible, '2026-11-15');
  end loop;
  perform public.park_work_target('26104170-0000-0000-0000-000000000011',
    '26104170-0000-0000-0000-000000000003', 'job', '26104170-0000-0000-0000-000000000059', 0,
    'material', null,
    (select id from public.employee_records
     where organization_id = '26104170-0000-0000-0000-000000000011'
       and user_id = '26104170-0000-0000-0000-000000000003'),
    '2026-11-15');
  if (select count(*) from public.jobs where id in (
      '26104170-0000-0000-0000-000000000050', '26104170-0000-0000-0000-000000000051',
      '26104170-0000-0000-0000-000000000052', '26104170-0000-0000-0000-000000000059')
      and status = 'geparkt') <> 4
  then raise exception 'the fixture jobs are not parked'; end if;
end;
$$;

-- Parking the planned job 052 marked this transaction as a planning write,
-- which mutes the job-to-plan sync until the transaction ends. The app runs
-- each call in its own transaction; this file runs in one, so the marker is
-- cleared before the calls under test.
select set_config('app.planning_projection_write', '', true);

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- The rows the refusals must leave untouched.
create temporary table parking_before on commit drop as
select 'job' as kind, to_jsonb(job) - 'updated_at' as row_data from public.jobs job
where job.organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011')
union all
select 'blocker', to_jsonb(blocker) - 'updated_at' from public.work_blockers blocker
where blocker.organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011')
union all
select 'event', to_jsonb(event) from public.work_blocker_events event
where event.organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011')
union all
select 'assignment', to_jsonb(assignment) - 'assigned_at' from public.job_assignments assignment
where assignment.organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011');
grant select on parking_before to service_role;

create function pg_temp.assert_parking_unchanged(p_label text) returns void
language plpgsql as $$
begin
  if exists (
    (select kind, row_data from parking_before)
    except
    (select 'job', to_jsonb(job) - 'updated_at' from public.jobs job
     where job.organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011')
     union all
     select 'blocker', to_jsonb(blocker) - 'updated_at' from public.work_blockers blocker
     where blocker.organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011')
     union all
     select 'event', to_jsonb(event) from public.work_blocker_events event
     where event.organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011')
     union all
     select 'assignment', to_jsonb(assignment) - 'assigned_at' from public.job_assignments assignment
     where assignment.organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011'))
  ) or (select count(*) from parking_before) <> (
    (select count(*) from public.jobs
     where organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011'))
    + (select count(*) from public.work_blockers
       where organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011'))
    + (select count(*) from public.work_blocker_events
       where organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011'))
    + (select count(*) from public.job_assignments
       where organization_id in ('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000011'))
  ) then
    raise exception '% changed the parked work', p_label;
  end if;
end;
$$;
grant execute on function pg_temp.assert_parking_unchanged(text) to service_role;

set local role service_role;

-- The schedule step refused after the unpark: an assignee of another
-- organization. The unpark is rolled back with it.
select pg_temp.expect_refusal('unpark with a refused schedule step', $sql$
  select public.unpark_job_into_schedule('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000050', 1,
    'Im Kalender neu eingeplant', '{"planned_date": "2026-11-02", "planned_time": "08:00:00"}', true,
    array['26104170-0000-0000-0000-000000000003'::uuid], '2026-11-02', '{}', '[]', '{}', 'fingerprint',
    null, null, false)
$sql$, 'assignment user is not an organization member');
select pg_temp.assert_parking_unchanged('the refused schedule step');

-- Precise refusals, each before anything is written.
select pg_temp.expect_refusal('stale parking version', $sql$
  select public.unpark_job_into_schedule('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000050', 0,
    'Im Kalender neu eingeplant', '{"planned_date": "2026-11-02"}', false,
    null, null, null, null, null, null, null, null, null)
$sql$, 'work_blocker_stale_version');
select pg_temp.expect_refusal('job of another organization', $sql$
  select public.unpark_job_into_schedule('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000059', 1,
    'Im Kalender neu eingeplant', '{"planned_date": "2026-11-02"}', false,
    null, null, null, null, null, null, null, null, null)
$sql$, 'job_not_found');
select pg_temp.expect_refusal('actor outside the planning roles', $sql$
  select public.unpark_job_into_schedule('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000002', '26104170-0000-0000-0000-000000000050', 1,
    'Im Kalender neu eingeplant', '{"planned_date": "2026-11-02"}', false,
    null, null, null, null, null, null, null, null, null)
$sql$, 'work_parking_not_authorized');
select pg_temp.expect_refusal('job edit outside the schedule columns', $sql$
  select public.unpark_job_into_schedule('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000050', 1,
    'Im Kalender neu eingeplant', '{"organization_id": "26104170-0000-0000-0000-000000000011"}', false,
    null, null, null, null, null, null, null, null, null)
$sql$, 'invalid_input');
select pg_temp.assert_parking_unchanged('the refused calls');

-- The success paths.
do $$
declare
  v_job public.jobs;
begin
  v_job := public.unpark_job_into_schedule('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000050', 1,
    'Im Kalender neu eingeplant',
    '{"planned_date": "2026-11-02", "planned_time": "08:00:00", "status": "nicht_bearbeitet"}', true,
    array['26104170-0000-0000-0000-000000000002'::uuid], '2026-11-02', '{}', '[]', '{}', 'fingerprint',
    null, null, true);
  if v_job.status <> 'nicht_bearbeitet' or v_job.planned_date <> '2026-11-02'
    or v_job.planned_time <> '08:00:00'
  then raise exception 'the unpark into the schedule did not apply'; end if;
  if exists (
    select 1 from public.work_blockers blocker
    where blocker.job_id = '26104170-0000-0000-0000-000000000050' and blocker.state = 'open'
  ) or not exists (
    select 1 from public.work_blocker_events event
    join public.work_blockers blocker on blocker.id = event.blocker_id
    where blocker.job_id = '26104170-0000-0000-0000-000000000050' and event.event_type = 'unparked'
  ) then raise exception 'the parking was not resolved with its event'; end if;
  if not exists (
    select 1 from public.job_assignments assignment
    where assignment.job_id = '26104170-0000-0000-0000-000000000050'
      and assignment.user_id = '26104170-0000-0000-0000-000000000002'
  ) or not exists (
    select 1 from public.job_qualification_assessments assessment
    where assessment.job_id = '26104170-0000-0000-0000-000000000050'
  ) then raise exception 'the assignments were not replaced with their assessment'; end if;
  if not exists (
    select 1 from public.planning_occurrences occurrence
    where occurrence.legacy_source_job_id = '26104170-0000-0000-0000-000000000050'
      and occurrence.status = 'scheduled'
  ) then raise exception 'the schedule did not reach the planning projection'; end if;

  -- The unpark decides the status: work parked in progress returns in
  -- progress, whatever status the edit carried.
  v_job := public.unpark_job_into_schedule('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000051', 1,
    'Im Kalender neu eingeplant', '{"planned_date": "2026-11-03", "status": "nicht_bearbeitet"}', false,
    null, null, null, null, null, null, null, null, null);
  if v_job.status <> 'in_bearbeitung' or v_job.planned_date <> '2026-11-03' then
    raise exception 'the edit overrode the status of the unpark';
  end if;

  -- Job 052 returns for both people. The employee never left the job, so the
  -- assignment replacement inserts nothing; the visit is still planned for both.
  v_job := public.unpark_job_into_schedule('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000052', 1,
    'Im Kalender neu eingeplant', '{"planned_date": "2026-11-04", "planned_time": "09:00:00"}', true,
    array['26104170-0000-0000-0000-000000000001'::uuid, '26104170-0000-0000-0000-000000000002'::uuid],
    '2026-11-04', '{}', '[]', '{}', 'fingerprint', null, null, false);
  if (select count(*) from public.planning_occurrence_assignments assignment
      join public.planning_occurrences occurrence on occurrence.id = assignment.occurrence_id
      where occurrence.legacy_source_job_id = '26104170-0000-0000-0000-000000000052'
        and occurrence.status = 'scheduled') <> 2
  then raise exception 'the unparked visit is not planned for the whole selection'; end if;

  if (select status from public.jobs where id = '26104170-0000-0000-0000-000000000059') <> 'geparkt' then
    raise exception 'an unpark reached another organization';
  end if;
end;
$$;

reset role;

-- Only the service role executes the function.
do $$
declare
  v_function constant text := 'public.unpark_job_into_schedule(uuid, uuid, uuid, bigint, text, jsonb, boolean, '
    'uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean)';
  v_role text;
begin
  if not has_function_privilege('service_role', v_function, 'execute') then
    raise exception '% lost its service_role grant', v_function;
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, v_function, 'execute') then
      raise exception '% is executable by %', v_function, v_role;
    end if;
  end loop;
  if exists (
    select 1 from pg_proc proc, aclexplode(proc.proacl) acl
    where proc.oid = v_function::regprocedure and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then raise exception '% is executable by public', v_function; end if;
end;
$$;

rollback;
