-- The bridge between a job's team (job_assignments) and its visit plan
-- (planning_occurrences and their assignments). docs/technical/data-model.md
-- ("Job team and visit plan") states the rules; this file drives every write
-- path that crosses the bridge and checks them after each call:
-- - every person with a login on a visit of the job that has not started is
--   on the job's team;
-- - the job's schedule columns describe its first scheduled visit, or are
--   empty without one;
-- - app.planning_projection_write is never left set after a call.
-- It also pins the cases that broke: a plan write for one visit echoed onto
-- the job's legacy visit, a team removal left the person on a calendar-planned
-- visit, a calendar move followed by park and unpark planned the visit for
-- fewer people than selected, and a projection muted a later job edit in the
-- same transaction (migrations 20261005110000, 20261006100000 and
-- 20261006100100). A job-page team change records the assessment of the
-- visit it reaches (20261108120000), and so does a job created or edited
-- with a date and people (20261124100000), a request converted into a job
-- and a parked job planned from the calendar (20261125090000). A leaver's
-- open work handed over moves visits and team together, and the open
-- absences are read in one call (20261129100000).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('b1d9e000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bridge-admin@example.test', '', now(), '{}',
 '{"first_name":"Anna","last_name":"Brücke"}', now(), now()),
('b1d9e000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bridge-bea@example.test', '', now(), '{}',
 '{"first_name":"Bea","last_name":"Brücke"}', now(), now()),
('b1d9e000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bridge-cem@example.test', '', now(), '{}',
 '{"first_name":"Cem","last_name":"Brücke"}', now(), now()),
('b1d9e000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bridge-foreign@example.test', '', now(), '{}',
 '{"first_name":"Fremd","last_name":"Brücke"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('b1d9e000-0000-4000-8000-000000000010', 'Bridge SQL',
 'b1d9e000-0000-4000-8000-000000000001', 'BRIDGESQ'),
('b1d9e000-0000-4000-8000-000000000011', 'Foreign bridge SQL',
 'b1d9e000-0000-4000-8000-000000000004', 'BRIDGEFO');
insert into public.organization_members (organization_id, user_id, role) values
('b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000002', 'employee'),
('b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000003', 'employee');
-- A person without a login can be on a visit and never on a team.
insert into public.employee_records (id, organization_id, first_name, last_name) values
('b1d9e000-0000-4000-8000-000000000029', 'b1d9e000-0000-4000-8000-000000000010', 'Nora', 'Ohnelogin');

-- Job 040 had its visit yesterday for Anna and Bea: a started visit.
insert into public.jobs (
  id, organization_id, job_number, title, status, planned_date, planned_time,
  estimated_duration_minutes, created_by
) values (
  'b1d9e000-0000-4000-8000-000000000040', 'b1d9e000-0000-4000-8000-000000000010', 'BRIDGE-4',
  'Wartung gestern', 'nicht_bearbeitet', (now() at time zone 'Europe/Berlin')::date - 1, '08:00', 60,
  'b1d9e000-0000-4000-8000-000000000001'
);
insert into public.job_assignments (job_id, user_id, assigned_by) values
('b1d9e000-0000-4000-8000-000000000040', 'b1d9e000-0000-4000-8000-000000000001',
 'b1d9e000-0000-4000-8000-000000000001'),
('b1d9e000-0000-4000-8000-000000000040', 'b1d9e000-0000-4000-8000-000000000002',
 'b1d9e000-0000-4000-8000-000000000001');
insert into public.planning_occurrence_assignments (organization_id, occurrence_id, employee_record_id)
select occurrence.organization_id, occurrence.id, employee.id
from public.planning_occurrences occurrence
join public.employee_records employee on employee.organization_id = occurrence.organization_id
where occurrence.legacy_source_job_id = 'b1d9e000-0000-4000-8000-000000000040'
  and employee.user_id in ('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
on conflict (occurrence_id, employee_record_id) do nothing;

-- Named ids the steps share.
create temporary table bridge_ids (name text primary key, id uuid not null) on commit drop;
grant select, insert on bridge_ids to service_role;
create function pg_temp.bridge_id(p_name text) returns uuid language sql as $$
  select id from bridge_ids where name = p_name;
$$;
create function pg_temp.record_of(p_user_id uuid) returns uuid language sql as $$
  select record.id from public.employee_records record
  where record.organization_id = 'b1d9e000-0000-4000-8000-000000000010' and record.user_id = p_user_id;
$$;
create function pg_temp.day(p_offset integer) returns date language sql as $$
  select (now() at time zone 'Europe/Berlin')::date + p_offset;
$$;
create function pg_temp.timed_item(p_job_id uuid, p_day date, p_time time, p_minutes integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'jobId', p_job_id, 'entryKind', 'job_visit', 'timeKind', 'timed',
    'originalStartLocal', to_char(p_day, 'YYYY-MM-DD') || 'T' || to_char(p_time, 'HH24:MI'),
    'identityOriginalStartLocal', to_char(p_day, 'YYYY-MM-DD') || 'T' || to_char(p_time, 'HH24:MI'),
    'startAt', (p_day + p_time) at time zone 'Europe/Berlin',
    'endAt', (p_day + p_time + make_interval(mins => p_minutes)) at time zone 'Europe/Berlin'
  );
$$;
create function pg_temp.assignment(p_item jsonb, p_user_id uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'occurrenceOriginalStartLocal', p_item->>'originalStartLocal',
    'employeeRecordId', pg_temp.record_of(p_user_id)
  );
$$;
-- The people on one visit, by login; a person without a login shows as null.
create function pg_temp.crew(p_occurrence_id uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(employee.user_id order by employee.user_id), '{}')
  from public.planning_occurrence_assignments assignment
  join public.employee_records employee on employee.id = assignment.employee_record_id
  where assignment.occurrence_id = p_occurrence_id;
$$;
create function pg_temp.team(p_job_id uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(assignment.user_id order by assignment.user_id), '{}')
  from public.job_assignments assignment where assignment.job_id = p_job_id;
$$;
create function pg_temp.legacy_visit(p_job_id uuid) returns uuid language sql as $$
  select id from public.planning_occurrences where legacy_source_job_id = p_job_id;
$$;
create function pg_temp.version_of(p_occurrence_id uuid) returns integer language sql as $$
  select version from public.planning_occurrences where id = p_occurrence_id;
$$;
create function pg_temp.users(variadic p_ids text[]) returns uuid[] language sql as $$
  select coalesce(array_agg(value::uuid order by value::uuid), '{}') from unnest(p_ids) value;
$$;

-- The rows a team change with a visit assessment can write: the operation
-- and occurrence assessments of the plan and the job's qualification
-- assessments. A refused change writes none of them.
create function pg_temp.assessment_counts() returns bigint[]
language sql
as $$
  select array[
    (select count(*) from public.planning_operation_assessments),
    (select count(*) from public.planning_occurrence_assessments),
    (select count(*) from public.job_qualification_assessments)
  ];
$$;

-- The rules that hold after every committed call.
create function pg_temp.assert_bridge(p_label text) returns void language plpgsql as $$
declare
  v_offender text;
begin
  if coalesce(current_setting('app.planning_projection_write', true), '') = 'true' then
    raise exception '%: the projection marker is still set, so a later job edit in this transaction would not reach its visit', p_label;
  end if;

  select string_agg(format('%s on visit %s of job %s', employee.user_id, occurrence.id, occurrence.job_id), '; ')
  into v_offender
  from public.planning_occurrences occurrence
  join public.planning_occurrence_assignments assignment on assignment.occurrence_id = occurrence.id
  join public.employee_records employee on employee.id = assignment.employee_record_id
  where occurrence.organization_id = 'b1d9e000-0000-4000-8000-000000000010'
    and occurrence.job_id is not null
    and employee.user_id is not null
    and coalesce(
      occurrence.start_at > now(),
      occurrence.start_date > (now() at time zone 'Europe/Berlin')::date,
      false
    )
    and not exists (
      select 1 from public.job_assignments team
      where team.job_id = occurrence.job_id and team.user_id = employee.user_id
    );
  if v_offender is not null then
    raise exception '%: a person on an upcoming visit is not on the job''s team: %', p_label, v_offender;
  end if;

  select string_agg(format('%s (%s %s)', job.job_number, job.planned_date, job.planned_time), '; ')
  into v_offender
  from public.jobs job
  left join lateral (
    select occurrence.start_at, occurrence.start_date
    from public.planning_occurrences occurrence
    where occurrence.organization_id = job.organization_id
      and occurrence.job_id = job.id
      and occurrence.status = 'scheduled'
    order by coalesce(occurrence.start_at, occurrence.start_date::timestamptz)
    limit 1
  ) first_visit on true
  where job.organization_id = 'b1d9e000-0000-4000-8000-000000000010'
    and (
      job.planned_date is distinct from
        coalesce((first_visit.start_at at time zone 'Europe/Berlin')::date, first_visit.start_date)
      or job.planned_time is distinct from (first_visit.start_at at time zone 'Europe/Berlin')::time
    );
  if v_offender is not null then
    raise exception '%: a job''s schedule is not its first scheduled visit: %', p_label, v_offender;
  end if;
end;
$$;
grant execute on all functions in schema pg_temp to service_role;

select pg_temp.assert_bridge('the fixture');

set local role service_role;

-- 1. Creating a planned job creates its legacy visit for the selected team.
do $$
declare
  v_job public.jobs;
begin
  v_job := public.create_job_with_assignments(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001',
    jsonb_build_object('title', 'Badsanierung', 'job_number', 'BRIDGE-1',
      'planned_date', pg_temp.day(10), 'planned_time', '08:00', 'estimated_duration_minutes', 120),
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
    pg_temp.day(10), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false);
  insert into bridge_ids values ('job 1', v_job.id), ('job 1 legacy visit', pg_temp.legacy_visit(v_job.id));
  if pg_temp.crew(pg_temp.bridge_id('job 1 legacy visit'))
     <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
  then raise exception 'creating a planned job did not plan its visit for the selected team'; end if;
  perform pg_temp.assert_bridge('creating a planned job');
end;
$$;

-- 2. A second visit of the job, planned in the calendar for Cem and Nora.
-- Cem joins the team. The legacy visit is a different visit and keeps its
-- people (before 20261006100100 Cem was echoed onto it).
do $$
declare
  v_item jsonb := pg_temp.timed_item(pg_temp.bridge_id('job 1'), pg_temp.day(12), '09:00', 60);
  v_ids uuid[];
begin
  v_ids := public.create_planning_entry_materialized(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', null,
    jsonb_build_array(v_item),
    jsonb_build_array(
      pg_temp.assignment(v_item, 'b1d9e000-0000-4000-8000-000000000003'),
      jsonb_build_object('occurrenceOriginalStartLocal', v_item->>'originalStartLocal',
        'employeeRecordId', 'b1d9e000-0000-4000-8000-000000000029')),
    gen_random_uuid(), '{}', 'capacity', '{}', 'qualification');
  insert into bridge_ids values ('job 1 second visit', v_ids[1]);
  if not 'b1d9e000-0000-4000-8000-000000000003'::uuid = any (pg_temp.team(pg_temp.bridge_id('job 1'))) then
    raise exception 'planning a visit for Cem did not put Cem on the job''s team';
  end if;
  if pg_temp.crew(pg_temp.bridge_id('job 1 legacy visit'))
     <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
  then raise exception 'planning the second visit changed the people on the legacy visit'; end if;
  perform pg_temp.assert_bridge('planning a second visit');
end;
$$;

-- 3. A calendar move of the legacy visit to another day and to Anna alone.
-- Bea leaves the visit and stays on the job: a plan write only adds people to
-- the team. The schedule and duration follow the moved visit.
do $$
declare
  v_visit uuid := pg_temp.bridge_id('job 1 legacy visit');
  v_item jsonb := pg_temp.timed_item(pg_temp.bridge_id('job 1'), pg_temp.day(11), '10:00', 90);
  v_job public.jobs;
begin
  perform public.update_planning_occurrence(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', v_visit,
    pg_temp.version_of(v_visit), v_item,
    jsonb_build_array(jsonb_build_object('employeeRecordId', pg_temp.record_of('b1d9e000-0000-4000-8000-000000000001'))),
    '{}', 'capacity', '{}', 'qualification');
  if pg_temp.crew(v_visit) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001') then
    raise exception 'the moved visit is not planned for Anna alone';
  end if;
  if not 'b1d9e000-0000-4000-8000-000000000002'::uuid = any (pg_temp.team(pg_temp.bridge_id('job 1'))) then
    raise exception 'a calendar move took Bea off the job''s team';
  end if;
  select * into v_job from public.jobs where id = pg_temp.bridge_id('job 1');
  if v_job.planned_date <> pg_temp.day(11) or v_job.planned_time <> '10:00' or v_job.estimated_duration_minutes <> 90 then
    raise exception 'the job''s schedule did not follow the moved visit';
  end if;
  perform pg_temp.assert_bridge('moving the legacy visit');
end;
$$;

-- 4. The sequence that broke: a planned job, a calendar move takes Bea off
-- its visit, the job is parked and dropped back on Bea's row.
do $$
declare
  v_job public.jobs;
  v_visit uuid;
  v_responsible uuid := pg_temp.record_of('b1d9e000-0000-4000-8000-000000000001');
begin
  v_job := public.create_job_with_assignments(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001',
    jsonb_build_object('title', 'Heizungstausch', 'job_number', 'BRIDGE-2',
      'planned_date', pg_temp.day(14), 'planned_time', '07:00', 'estimated_duration_minutes', 60),
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
    pg_temp.day(14), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false);
  v_visit := pg_temp.legacy_visit(v_job.id);
  insert into bridge_ids values ('job 2', v_job.id), ('job 2 legacy visit', v_visit);

  perform public.update_planning_occurrence(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', v_visit,
    pg_temp.version_of(v_visit), pg_temp.timed_item(v_job.id, pg_temp.day(14), '07:00', 60),
    jsonb_build_array(jsonb_build_object('employeeRecordId', v_responsible)),
    '{}', 'capacity', '{}', 'qualification');
  perform pg_temp.assert_bridge('taking Bea off the visit');

  perform public.park_work_target('b1d9e000-0000-4000-8000-000000000010',
    'b1d9e000-0000-4000-8000-000000000001', 'job', v_job.id, 0, 'material', null,
    v_responsible, pg_temp.day(20));
  if (select status from public.planning_occurrences where id = v_visit) <> 'cancelled' then
    raise exception 'parking did not cancel the visit';
  end if;
  if pg_temp.crew(v_visit) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001')
     or pg_temp.team(v_job.id)
       <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
  then raise exception 'parking changed the team or the people of the cancelled visit'; end if;
  perform pg_temp.assert_bridge('parking the job');

  v_job := public.unpark_job_into_schedule('b1d9e000-0000-4000-8000-000000000010',
    'b1d9e000-0000-4000-8000-000000000001', v_job.id, 1, 'Im Kalender neu eingeplant',
    jsonb_build_object('planned_date', pg_temp.day(15), 'planned_time', '09:00'), true,
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
    pg_temp.day(15), '{}', '[]', '{}', 'fingerprint', null, null, false);
  if (select status from public.planning_occurrences where id = v_visit) <> 'scheduled'
     or pg_temp.crew(v_visit)
       <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
  then raise exception 'the unparked visit is not planned for the whole selection'; end if;
  perform pg_temp.assert_bridge('unparking into the schedule');
end;
$$;

-- 5. A projection and then a job edit in the same transaction: the edit
-- still moves the visit (before 20261006100000 the marker stayed set and the
-- edit never reached the plan).
do $$
declare
  v_job_id uuid := pg_temp.bridge_id('job 2');
  v_visit uuid := pg_temp.bridge_id('job 2 legacy visit');
begin
  perform public.update_planning_occurrence(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', v_visit,
    pg_temp.version_of(v_visit), pg_temp.timed_item(v_job_id, pg_temp.day(15), '09:00', 60),
    jsonb_build_array(
      jsonb_build_object('employeeRecordId', pg_temp.record_of('b1d9e000-0000-4000-8000-000000000001')),
      jsonb_build_object('employeeRecordId', pg_temp.record_of('b1d9e000-0000-4000-8000-000000000002'))),
    '{}', 'capacity', '{}', 'qualification');
  perform public.update_job_with_assignments(
    'b1d9e000-0000-4000-8000-000000000010', v_job_id, 'b1d9e000-0000-4000-8000-000000000001',
    jsonb_build_object('planned_date', pg_temp.day(16)), false,
    null, null, null, null, null, null, null, null, null);
  if (select (start_at at time zone 'Europe/Berlin')::date from public.planning_occurrences where id = v_visit)
     <> pg_temp.day(16)
  then raise exception 'a job edit after a projection in the same transaction did not reach the visit'; end if;
  perform pg_temp.assert_bridge('a job edit after a projection');
end;
$$;

-- 6. Team edits reach the upcoming visits. Taking Cem off the team takes Cem
-- off every upcoming visit of the job, also the calendar-planned one; Nora,
-- without a login, stays. Adding Cem back reaches the legacy visit only.
do $$
declare
  v_job_id uuid := pg_temp.bridge_id('job 1');
begin
  perform public.update_job_with_assignments(
    'b1d9e000-0000-4000-8000-000000000010', v_job_id, 'b1d9e000-0000-4000-8000-000000000001',
    '{}', true,
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
    pg_temp.day(11), '{}', '[]', '{}', 'fingerprint', null, null, false);
  if pg_temp.crew(pg_temp.bridge_id('job 1 second visit')) <> array[null::uuid] then
    raise exception 'taking Cem off the team did not take Cem off the calendar-planned visit';
  end if;
  perform pg_temp.assert_bridge('taking a person off the team');

  perform public.replace_job_assignments_with_assessment(
    'b1d9e000-0000-4000-8000-000000000010', v_job_id,
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002',
      'b1d9e000-0000-4000-8000-000000000003'),
    'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(11), '{}', '[]', '{}', 'fingerprint',
    null, null, false);
  if pg_temp.crew(pg_temp.bridge_id('job 1 legacy visit'))
       <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000003')
     or pg_temp.crew(pg_temp.bridge_id('job 1 second visit')) <> array[null::uuid]
  then raise exception 'adding Cem to the team did not reach exactly the legacy visit'; end if;
  perform pg_temp.assert_bridge('adding a person to the team');
end;
$$;

-- 7. Cancelling the first visit hands the schedule to the next one, with
-- its duration. The cancelled visit keeps its people as history.
do $$
declare
  v_visit uuid := pg_temp.bridge_id('job 1 legacy visit');
  v_job public.jobs;
begin
  perform public.set_planning_occurrence_status(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', v_visit,
    pg_temp.version_of(v_visit), 'cancelled', 'Kunde hat abgesagt');
  select * into v_job from public.jobs where id = pg_temp.bridge_id('job 1');
  if v_job.planned_date <> pg_temp.day(12) or v_job.planned_time <> '09:00' or v_job.estimated_duration_minutes <> 60 then
    raise exception 'cancelling the first visit did not hand the schedule and duration to the next visit';
  end if;
  if pg_temp.crew(v_visit)
     <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000003')
  then raise exception 'cancelling a visit changed its people'; end if;
  perform pg_temp.assert_bridge('cancelling a visit');
end;
$$;

-- 8. A batch move of the remaining visit.
do $$
declare
  v_visit uuid := pg_temp.bridge_id('job 1 second visit');
  v_job public.jobs;
begin
  perform public.batch_reschedule_planning_occurrences(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', gen_random_uuid(),
    'Lieferung verspätet sich',
    jsonb_build_array(jsonb_build_object(
      'occurrenceId', v_visit, 'expectedVersion', pg_temp.version_of(v_visit),
      'startAt', (pg_temp.day(13) + time '14:00') at time zone 'Europe/Berlin',
      'endAt', (pg_temp.day(13) + time '16:00') at time zone 'Europe/Berlin')),
    '{}', 'capacity', '{}', 'qualification');
  select * into v_job from public.jobs where id = pg_temp.bridge_id('job 1');
  if v_job.planned_date <> pg_temp.day(13) or v_job.planned_time <> '14:00' or v_job.estimated_duration_minutes <> 120 then
    raise exception 'the job''s schedule did not follow the batch move';
  end if;
  perform pg_temp.assert_bridge('a batch move');
end;
$$;

-- 9. A series for an unscheduled job: create for Bea, extend for Cem, then
-- change the whole series to Anna. Everyone planned joins the team, nobody
-- leaves it, and the schedule is the first scheduled occurrence.
do $$
declare
  v_job public.jobs;
  v_series jsonb;
  v_items jsonb;
  v_ids uuid[];
  v_series_id uuid;
  v_new jsonb;
begin
  v_job := public.create_job_with_assignments(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001',
    jsonb_build_object('title', 'Wöchentliche Kontrolle', 'job_number', 'BRIDGE-3'),
    '{}', null, '{}', '[]', '{}', 'fingerprint', null, null, false, null, false);
  if pg_temp.legacy_visit(v_job.id) is not null then
    raise exception 'an unscheduled job got a legacy visit';
  end if;
  v_series := jsonb_build_object(
    'jobId', v_job.id, 'entryKind', 'job_visit', 'timeKind', 'timed',
    'startsAtLocal', to_char(pg_temp.day(20), 'YYYY-MM-DD') || 'T07:00',
    'segmentStartLocal', to_char(pg_temp.day(20), 'YYYY-MM-DD') || 'T07:00',
    'durationMinutes', 60, 'frequency', 'daily', 'interval', 1, 'occurrenceCount', 5,
    'generatedThroughLocal', to_char(pg_temp.day(22), 'YYYY-MM-DD') || 'T07:00');
  select jsonb_agg(pg_temp.timed_item(v_job.id, pg_temp.day(day), '07:00', 60) order by day)
  into v_items from generate_series(20, 22) day;
  v_ids := public.create_planning_entry_materialized(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', v_series, v_items,
    (select jsonb_agg(pg_temp.assignment(item, 'b1d9e000-0000-4000-8000-000000000002'))
     from jsonb_array_elements(v_items) item),
    gen_random_uuid(), '{}', 'capacity', '{}', 'qualification');
  if pg_temp.team(v_job.id) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000002') then
    raise exception 'creating a series did not put Bea on the job''s team';
  end if;
  perform pg_temp.assert_bridge('creating a series');

  select series_id into v_series_id from public.planning_occurrences where id = v_ids[1];
  select jsonb_agg(pg_temp.timed_item(v_job.id, pg_temp.day(day), '07:00', 60) order by day)
  into v_new from generate_series(23, 24) day;
  perform public.extend_planning_series_materialization(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', v_series_id,
    (pg_temp.day(22) + time '07:00')::timestamp, v_new,
    (select jsonb_agg(pg_temp.assignment(item, 'b1d9e000-0000-4000-8000-000000000003'))
     from jsonb_array_elements(v_new) item),
    '{}', 'capacity', '{}', 'qualification');
  if pg_temp.team(v_job.id)
     <> pg_temp.users('b1d9e000-0000-4000-8000-000000000002', 'b1d9e000-0000-4000-8000-000000000003')
  then raise exception 'extending a series did not put Cem on the job''s team'; end if;
  perform pg_temp.assert_bridge('extending a series');

  perform public.reschedule_planning_series(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', v_ids[1],
    pg_temp.version_of(v_ids[1]), 'series',
    v_series || jsonb_build_object('startsAtLocal', to_char(pg_temp.day(20), 'YYYY-MM-DD') || 'T11:00',
      'generatedThroughLocal', to_char(pg_temp.day(24), 'YYYY-MM-DD') || 'T11:00'),
    (select jsonb_agg(pg_temp.timed_item(v_job.id, pg_temp.day(day), '11:00', 60)
       || jsonb_build_object('identityOriginalStartLocal', to_char(pg_temp.day(day), 'YYYY-MM-DD') || 'T07:00')
       order by day) from generate_series(20, 24) day),
    jsonb_build_array(jsonb_build_object('employeeRecordId', pg_temp.record_of('b1d9e000-0000-4000-8000-000000000001'))),
    '{}', 'capacity', '{}', 'qualification');
  if pg_temp.team(v_job.id) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001',
       'b1d9e000-0000-4000-8000-000000000002', 'b1d9e000-0000-4000-8000-000000000003')
  then raise exception 'changing the series did not add Anna or took someone off the team'; end if;
  if exists (
    select 1 from public.planning_occurrences occurrence
    where occurrence.job_id = v_job.id and occurrence.status = 'scheduled'
      and pg_temp.crew(occurrence.id) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001')
  ) then raise exception 'the changed series is not planned for Anna on every occurrence'; end if;
  if (select planned_time from public.jobs where id = v_job.id) <> '11:00' then
    raise exception 'the job''s schedule did not follow the changed series';
  end if;
  perform pg_temp.assert_bridge('changing a whole series');
end;
$$;

-- 10. A started visit is history: team edits leave its people alone.
do $$
declare
  v_job_id constant uuid := 'b1d9e000-0000-4000-8000-000000000040';
  v_visit uuid := pg_temp.legacy_visit('b1d9e000-0000-4000-8000-000000000040');
begin
  perform public.replace_job_assignments_with_assessment(
    'b1d9e000-0000-4000-8000-000000000010', v_job_id,
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000003'),
    'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(0), '{}', '[]', '{}', 'fingerprint',
    null, null, false);
  if pg_temp.crew(v_visit)
     <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
  then raise exception 'a team edit rewrote the people of a started visit'; end if;
  perform pg_temp.assert_bridge('a team edit after the visit started');
end;
$$;

-- 11. The projection writes only inside the organization it is given.
do $$
declare
  v_before jsonb := (select to_jsonb(job) from public.jobs job where id = pg_temp.bridge_id('job 2'));
begin
  perform app_private.project_plan_onto_job(
    'b1d9e000-0000-4000-8000-000000000011', pg_temp.bridge_id('job 2'),
    'b1d9e000-0000-4000-8000-000000000004', array[pg_temp.record_of('b1d9e000-0000-4000-8000-000000000003')]);
  if (select to_jsonb(job) from public.jobs job where id = pg_temp.bridge_id('job 2')) <> v_before
     or pg_temp.team(pg_temp.bridge_id('job 2'))
       <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
  then raise exception 'the projection wrote a job of another organization'; end if;
  perform pg_temp.assert_bridge('a projection for another organization');
end;
$$;

-- 12. A job-page team change that adds a person records the capacity
-- assessment of the legacy visit it reaches, with the manager's reason, in
-- the same call (20261108120000). A stale visit, a foreign organization and a
-- team that changed since the server read it change nothing.
do $$
declare
  v_job public.jobs;
  v_visit uuid;
  v_version integer;
  v_assessments integer;
  v_written bigint[];
begin
  v_job := public.create_job_with_assignments(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001',
    jsonb_build_object('title', 'Gastherme', 'job_number', 'BRIDGE-12',
      'planned_date', pg_temp.day(12), 'planned_time', '08:00', 'estimated_duration_minutes', 60),
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001'),
    pg_temp.day(12), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false);
  v_visit := pg_temp.legacy_visit(v_job.id);
  v_version := pg_temp.version_of(v_visit);
  v_written := pg_temp.assessment_counts();

  begin
    perform public.replace_job_assignments_with_visit_assessment(
      'b1d9e000-0000-4000-8000-000000000010', v_job.id,
      pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
      'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(12), '{}', '[]', '{}', 'fingerprint',
      null, null, false, pg_temp.users('b1d9e000-0000-4000-8000-000000000001'),
      v_visit, v_version + 1, '{"conflicts":[]}', 'capacity', '{"evaluations":[]}', 'qualification',
      'Mit dem Kunden abgestimmt');
    raise exception 'a stale visit version was accepted';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  begin
    perform public.replace_job_assignments_with_visit_assessment(
      'b1d9e000-0000-4000-8000-000000000011', v_job.id,
      pg_temp.users('b1d9e000-0000-4000-8000-000000000004'),
      'b1d9e000-0000-4000-8000-000000000004', pg_temp.day(12), '{}', '[]', '{}', 'fingerprint',
      null, null, false, pg_temp.users('b1d9e000-0000-4000-8000-000000000001'),
      v_visit, v_version, '{"conflicts":[]}', 'capacity', '{"evaluations":[]}', 'qualification',
      'Fremde Organisation');
    raise exception 'a job of another organization was accepted';
  exception when others then
    if sqlerrm <> 'job organization mismatch' then raise; end if;
  end;
  -- The visit of another job of the same organization is not this job's visit.
  if not exists (
    select 1 from public.planning_occurrences
    where id = pg_temp.bridge_id('job 2 legacy visit')
      and organization_id = 'b1d9e000-0000-4000-8000-000000000010'
  ) then raise exception 'the fixture lost the other job''s visit'; end if;
  begin
    perform public.replace_job_assignments_with_visit_assessment(
      'b1d9e000-0000-4000-8000-000000000010', v_job.id,
      pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
      'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(12), '{}', '[]', '{}', 'fingerprint',
      null, null, false, pg_temp.users('b1d9e000-0000-4000-8000-000000000001'),
      pg_temp.bridge_id('job 2 legacy visit'), pg_temp.version_of(pg_temp.bridge_id('job 2 legacy visit')),
      '{"conflicts":[]}', 'capacity', '{"evaluations":[]}', 'qualification', 'Anderer Auftrag');
    raise exception 'the visit of another job was accepted';
  exception when others then
    if sqlerrm <> 'planning_occurrence_not_found' then raise; end if;
  end;
  -- A visit assessment without a version never passes the stale check.
  begin
    perform public.replace_job_assignments_with_visit_assessment(
      'b1d9e000-0000-4000-8000-000000000010', v_job.id,
      pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
      'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(12), '{}', '[]', '{}', 'fingerprint',
      null, null, false, pg_temp.users('b1d9e000-0000-4000-8000-000000000001'),
      v_visit, null, '{"conflicts":[]}', 'capacity', '{"evaluations":[]}', 'qualification',
      'Ohne Version');
    raise exception 'a visit assessment without a version was accepted';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  -- The team changed after the server read it (here: the server read Anna and
  -- Cem): even a change that the server found to add nobody is refused, so no
  -- person reaches the visit unassessed.
  begin
    perform public.replace_job_assignments_with_visit_assessment(
      'b1d9e000-0000-4000-8000-000000000010', v_job.id,
      pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
      'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(12), '{}', '[]', '{}', 'fingerprint',
      null, null, false,
      pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
      null, null, null, null, null, null, null);
    raise exception 'a team change assessed against a stale team was accepted';
  exception when others then
    if sqlerrm <> 'stale_job_assignments' then raise; end if;
  end;
  if pg_temp.team(v_job.id) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001')
     or pg_temp.crew(v_visit) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001')
     or exists (select 1 from public.planning_occurrence_assessments where occurrence_id = v_visit)
     or pg_temp.assessment_counts() <> v_written
  then raise exception 'a refused team change changed the team, the visit or its history'; end if;

  perform public.replace_job_assignments_with_visit_assessment(
    'b1d9e000-0000-4000-8000-000000000010', v_job.id,
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
    'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(12), '{}', '[]', '{}', 'fingerprint',
    null, null, false, pg_temp.users('b1d9e000-0000-4000-8000-000000000001'),
    v_visit, v_version, '{"conflicts":[]}', 'capacity', '{"evaluations":[]}', 'qualification',
    '  Mit dem Kunden abgestimmt  ');
  if pg_temp.team(v_job.id)
       <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
     or pg_temp.crew(v_visit)
       <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002')
  then raise exception 'a confirmed team change did not reach the team and its legacy visit'; end if;
  if not exists (
    select 1
    from public.planning_occurrence_assessments assessment
    join public.planning_operation_assessments operation on operation.id = assessment.operation_assessment_id
    where assessment.occurrence_id = v_visit
      and assessment.override_reason = 'Mit dem Kunden abgestimmt'
      and assessment.capacity_fingerprint = 'capacity'
      and assessment.created_by = 'b1d9e000-0000-4000-8000-000000000001'
      and assessment.selected_employee_record_ids = array(
        select unnest(array[
          pg_temp.record_of('b1d9e000-0000-4000-8000-000000000001'),
          pg_temp.record_of('b1d9e000-0000-4000-8000-000000000002')
        ]) order by 1
      )
      and operation.capacity_snapshot = '{"conflicts":[]}'
  ) then raise exception 'a confirmed team change did not record the visit''s assessment with its reason'; end if;
  perform pg_temp.assert_bridge('a team change with a visit assessment');

  -- A change without a visit assessment is the plain team replacement.
  select count(*) into v_assessments from public.planning_occurrence_assessments where occurrence_id = v_visit;
  perform public.replace_job_assignments_with_visit_assessment(
    'b1d9e000-0000-4000-8000-000000000010', v_job.id,
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001'),
    'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(12), '{}', '[]', '{}', 'fingerprint',
    null, null, false,
    pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000002'),
    null, null, null, null, null, null, null);
  if pg_temp.team(v_job.id) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001')
     or (select count(*) from public.planning_occurrence_assessments where occurrence_id = v_visit) <> v_assessments
  then raise exception 'a team change without a visit assessment recorded one or missed the team'; end if;
  perform pg_temp.assert_bridge('a team change without a visit assessment');

  -- The server read the job without a visit; the visit was scheduled before
  -- the write. Adding a person without an assessment is refused.
  update public.jobs set planned_date = null, planned_time = null where id = v_job.id;
  update public.jobs set planned_date = pg_temp.day(13), planned_time = '09:00' where id = v_job.id;
  v_written := pg_temp.assessment_counts();
  begin
    perform public.replace_job_assignments_with_visit_assessment(
      'b1d9e000-0000-4000-8000-000000000010', v_job.id,
      pg_temp.users('b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000003'),
      'b1d9e000-0000-4000-8000-000000000001', pg_temp.day(13), '{}', '[]', '{}', 'fingerprint',
      null, null, false, pg_temp.users('b1d9e000-0000-4000-8000-000000000001'),
      null, null, null, null, null, null, null);
    raise exception 'an unassessed addition reached a visit scheduled meanwhile';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  if pg_temp.team(v_job.id) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001')
     or pg_temp.crew(pg_temp.legacy_visit(v_job.id)) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000001')
     or pg_temp.assessment_counts() <> v_written
  then raise exception 'a refused unassessed addition changed the team, the visit or its history'; end if;
  perform pg_temp.assert_bridge('an unassessed addition to a visit scheduled meanwhile');
end;
$$;

-- 13. The job create and edit dialogs plan the legacy visit with its people
-- (20261124100000). A save that leaves a scheduled, unstarted visit with
-- people, after moving it or adding someone, records the assessment of
-- exactly that visit, with the reason; without one, or for another visit
-- than the one it leaves, it changes nothing.
reset role;
create function pg_temp.visit_assessment(
  p_day date, p_time time, p_minutes integer, p_users uuid[], p_reason text
) returns jsonb language sql as $$
  select jsonb_build_object(
    'employee_record_ids', (select jsonb_agg(pg_temp.record_of(user_id)) from unnest(p_users) user_id),
    'start_at', (p_day + p_time) at time zone 'Europe/Berlin',
    'end_at', (p_day + p_time + make_interval(mins => p_minutes)) at time zone 'Europe/Berlin',
    'start_date', null,
    'end_date_exclusive', null,
    'capacity_snapshot', '{"conflicts":[]}'::jsonb,
    'capacity_fingerprint', 'capacity',
    'qualification_snapshot', '{"evaluations":[]}'::jsonb,
    'qualification_fingerprint', 'qualification',
    'override_reason', p_reason
  );
$$;
create function pg_temp.create_job(p_number text, p_job jsonb, p_users uuid[], p_assessment jsonb)
returns public.jobs language sql as $$
  select * from public.create_job_with_visit_assessment(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001',
    p_job || jsonb_build_object('title', 'Heizungstausch', 'job_number', p_number),
    p_users, (p_job->>'planned_date')::date, '{}', '[]', '{}', 'fingerprint', null, null, false, null, false,
    p_assessment);
$$;
create function pg_temp.edit_job(
  p_organization_id uuid, p_job_id uuid, p_changes jsonb, p_users uuid[], p_assessment jsonb
) returns public.jobs language sql as $$
  select * from public.update_job_with_visit_assessment(
    p_organization_id, p_job_id, 'b1d9e000-0000-4000-8000-000000000001', p_changes, p_users is not null,
    p_users, null, case when p_users is null then null else '{}'::uuid[] end, '[]', '{}', 'fingerprint',
    null, null, false, p_assessment);
$$;
create function pg_temp.visit_assessments(p_job_id uuid) returns bigint language sql as $$
  select count(*) from public.planning_occurrence_assessments
  where occurrence_id = pg_temp.legacy_visit(p_job_id);
$$;
grant execute on all functions in schema pg_temp to service_role;
set local role service_role;

do $$
declare
  v_anna uuid := 'b1d9e000-0000-4000-8000-000000000001';
  v_bea uuid := 'b1d9e000-0000-4000-8000-000000000002';
  v_cem uuid := 'b1d9e000-0000-4000-8000-000000000003';
  v_planned jsonb := jsonb_build_object(
    'planned_date', pg_temp.day(14), 'planned_time', '08:00', 'estimated_duration_minutes', 60);
  v_job public.jobs;
  v_written bigint[];
begin
  -- A planned job with people and no assessment is not created.
  v_written := pg_temp.assessment_counts();
  begin
    perform pg_temp.create_job('BRIDGE-13-A', v_planned, pg_temp.users(v_anna::text, v_bea::text), null);
    raise exception 'a planned job with people was created without the visit''s assessment';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  -- An assessment of other people than the visit gets is refused the same way.
  begin
    perform pg_temp.create_job('BRIDGE-13-A', v_planned, pg_temp.users(v_anna::text, v_bea::text),
      pg_temp.visit_assessment(pg_temp.day(14), '08:00', 60, pg_temp.users(v_anna::text), 'Abgestimmt'));
    raise exception 'a job was created with the assessment of another crew';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  if exists (select 1 from public.jobs where job_number = 'BRIDGE-13-A')
     or pg_temp.assessment_counts() <> v_written
  then raise exception 'a refused job creation left the job, its visit or its history'; end if;

  -- With the assessment of exactly its visit, the job, the visit and the
  -- assessment with the reason are one call.
  v_job := pg_temp.create_job('BRIDGE-13-A', v_planned, pg_temp.users(v_anna::text, v_bea::text),
    pg_temp.visit_assessment(pg_temp.day(14), '08:00', 60, pg_temp.users(v_anna::text, v_bea::text),
      '  Urlaub mit Bea abgestimmt  '));
  if pg_temp.crew(pg_temp.legacy_visit(v_job.id)) <> pg_temp.users(v_anna::text, v_bea::text)
     or not exists (
       select 1
       from public.planning_occurrence_assessments assessment
       join public.planning_operation_assessments operation
         on operation.id = assessment.operation_assessment_id
       where assessment.occurrence_id = pg_temp.legacy_visit(v_job.id)
         and assessment.override_reason = 'Urlaub mit Bea abgestimmt'
         and assessment.capacity_fingerprint = 'capacity'
         and assessment.created_by = v_anna
         and assessment.selected_employee_record_ids
           = (select array_agg(id order by id) from unnest(array[
               pg_temp.record_of(v_anna), pg_temp.record_of(v_bea)]) id)
         and operation.capacity_snapshot = '{"conflicts":[]}'
     )
  then raise exception 'a confirmed job creation did not record its visit''s assessment with the reason'; end if;
  perform pg_temp.assert_bridge('a job creation with a visit assessment');

  -- Without people, without a date, or with a visit that already started, no assessment is due.
  perform pg_temp.create_job('BRIDGE-13-B', v_planned, '{}', null);
  perform pg_temp.create_job('BRIDGE-13-C', '{}', pg_temp.users(v_anna::text), null);
  perform pg_temp.create_job('BRIDGE-13-D', jsonb_build_object('planned_date', pg_temp.day(0)),
    pg_temp.users(v_anna::text), null);
  perform pg_temp.assert_bridge('job creations that plan nobody on an upcoming visit');

  -- Moving the visit without its assessment changes nothing.
  v_written := pg_temp.assessment_counts();
  begin
    perform pg_temp.edit_job('b1d9e000-0000-4000-8000-000000000010', v_job.id,
      jsonb_build_object('planned_date', pg_temp.day(15)), null, null);
    raise exception 'a job edit moved a visit with people without its assessment';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  -- An assessment of another time than the one the edit leaves is refused.
  begin
    perform pg_temp.edit_job('b1d9e000-0000-4000-8000-000000000010', v_job.id,
      jsonb_build_object('planned_date', pg_temp.day(15)), null,
      pg_temp.visit_assessment(pg_temp.day(15), '09:00', 60, pg_temp.users(v_anna::text, v_bea::text),
        'Kunde verschiebt'));
    raise exception 'a job edit was saved with the assessment of another time';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  -- Adding a person to the visit without its assessment is refused too.
  begin
    perform pg_temp.edit_job('b1d9e000-0000-4000-8000-000000000010', v_job.id, '{}',
      pg_temp.users(v_anna::text, v_bea::text, v_cem::text), null);
    raise exception 'a job edit added a person to the visit without its assessment';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  -- A foreign organization's id reaches no job.
  begin
    perform pg_temp.edit_job('b1d9e000-0000-4000-8000-000000000011', v_job.id,
      jsonb_build_object('planned_date', pg_temp.day(15)), null,
      pg_temp.visit_assessment(pg_temp.day(15), '08:00', 60, pg_temp.users(v_anna::text, v_bea::text),
        'Fremde Organisation'));
    raise exception 'a job edit reached a job of another organization';
  exception when others then
    if sqlerrm <> 'job_not_found' then raise; end if;
  end;
  select * into v_job from public.jobs where id = v_job.id;
  if v_job.planned_date <> pg_temp.day(14)
     or pg_temp.team(v_job.id) <> pg_temp.users(v_anna::text, v_bea::text)
     or pg_temp.crew(pg_temp.legacy_visit(v_job.id)) <> pg_temp.users(v_anna::text, v_bea::text)
     or pg_temp.assessment_counts() <> v_written
  then raise exception 'a refused job edit changed the job, its visit or its history'; end if;

  -- The confirmed move records the moved visit's assessment.
  perform pg_temp.edit_job('b1d9e000-0000-4000-8000-000000000010', v_job.id,
    jsonb_build_object('planned_date', pg_temp.day(15)), null,
    pg_temp.visit_assessment(pg_temp.day(15), '08:00', 60, pg_temp.users(v_anna::text, v_bea::text),
      'Kunde verschiebt'));
  if pg_temp.visit_assessments(v_job.id) <> 2
     or not exists (
       select 1 from public.planning_occurrence_assessments
       where occurrence_id = pg_temp.legacy_visit(v_job.id) and override_reason = 'Kunde verschiebt'
     )
  then raise exception 'a confirmed job edit did not record the moved visit''s assessment'; end if;
  perform pg_temp.assert_bridge('a job edit with a visit assessment');

  -- An edit that neither moves the visit nor adds anyone needs no assessment.
  perform pg_temp.edit_job('b1d9e000-0000-4000-8000-000000000010', v_job.id,
    jsonb_build_object('title', 'Heizungstausch Keller'), null, null);
  perform pg_temp.edit_job('b1d9e000-0000-4000-8000-000000000010', v_job.id, '{}',
    pg_temp.users(v_anna::text), null);
  if pg_temp.crew(pg_temp.legacy_visit(v_job.id)) <> pg_temp.users(v_anna::text)
     or pg_temp.visit_assessments(v_job.id) <> 2
  then raise exception 'a job edit that adds nobody to the visit recorded an assessment or missed the change'; end if;
  perform pg_temp.assert_bridge('a job edit that adds nobody to the visit');
end;
$$;

-- 14. Turning an Anfrage into an Auftrag and planning a parked job from the
-- calendar plan the legacy visit with its people too (20261125090000). The
-- unpark puts the whole team on the visit, also a person a calendar move took
-- off it, and also on a visit planned for today, which the team triggers
-- leave alone. Without the assessment of exactly that visit, neither writes
-- anything: the request stays open, the job stays parked.
reset role;
insert into public.clients (id, organization_id, name) values
('b1d9e000-0000-4000-8000-000000000060', 'b1d9e000-0000-4000-8000-000000000010', 'Kunde Brücke'),
('b1d9e000-0000-4000-8000-000000000061', 'b1d9e000-0000-4000-8000-000000000011', 'Fremder Kunde Brücke');
insert into public.client_requests (id, organization_id, summary, client_id, created_by) values
('b1d9e000-0000-4000-8000-000000000062', 'b1d9e000-0000-4000-8000-000000000010', 'Heizung kalt',
 'b1d9e000-0000-4000-8000-000000000060', 'b1d9e000-0000-4000-8000-000000000001');
create function pg_temp.convert_request(p_organization_id uuid, p_users uuid[], p_assessment jsonb)
returns public.jobs language sql as $$
  select * from public.convert_client_request_to_job_with_visit_assessment(
    p_organization_id, 'b1d9e000-0000-4000-8000-000000000001', 'b1d9e000-0000-4000-8000-000000000062',
    jsonb_build_object('title', 'Heizung kalt', 'job_number', 'BRIDGE-14-A',
      'client_id', 'b1d9e000-0000-4000-8000-000000000060',
      'planned_date', pg_temp.day(21), 'planned_time', '08:00', 'estimated_duration_minutes', 60),
    p_users, pg_temp.day(21), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false,
    p_assessment);
$$;
create function pg_temp.unpark(p_organization_id uuid, p_job_id uuid, p_users uuid[], p_assessment jsonb)
returns public.jobs language sql as $$
  select * from public.unpark_job_into_schedule_with_visit_assessment(
    p_organization_id, 'b1d9e000-0000-4000-8000-000000000001', p_job_id, 1, 'Im Kalender neu eingeplant',
    jsonb_build_object('planned_date', pg_temp.day(22), 'planned_time', '09:00'), true,
    p_users, pg_temp.day(22), '{}', '[]', '{}', 'fingerprint', null, null, false, p_assessment);
$$;
grant execute on all functions in schema pg_temp to service_role;
set local role service_role;

do $$
declare
  v_anna uuid := 'b1d9e000-0000-4000-8000-000000000001';
  v_bea uuid := 'b1d9e000-0000-4000-8000-000000000002';
  v_crew uuid[] := pg_temp.users('b1d9e000-0000-4000-8000-000000000001',
    'b1d9e000-0000-4000-8000-000000000002');
  v_job public.jobs;
  v_visit uuid;
  v_written bigint[];
  v_blocker_version bigint;
begin
  -- A conversion that plans people without the visit's assessment, or with
  -- the assessment of other people, converts nothing.
  v_written := pg_temp.assessment_counts();
  begin
    perform pg_temp.convert_request('b1d9e000-0000-4000-8000-000000000010', v_crew, null);
    raise exception 'a request was converted into a planned job with people without the visit''s assessment';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  begin
    perform pg_temp.convert_request('b1d9e000-0000-4000-8000-000000000010', v_crew,
      pg_temp.visit_assessment(pg_temp.day(21), '08:00', 60, pg_temp.users(v_anna::text), 'Abgestimmt'));
    raise exception 'a request was converted with the assessment of another crew';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  -- A foreign organization's id reaches no request.
  begin
    perform pg_temp.convert_request('b1d9e000-0000-4000-8000-000000000011', v_crew,
      pg_temp.visit_assessment(pg_temp.day(21), '08:00', 60, v_crew, 'Fremde Organisation'));
    raise exception 'a conversion reached a request of another organization';
  exception when others then
    if sqlerrm <> 'request_not_found' then raise; end if;
  end;
  if exists (select 1 from public.jobs where job_number = 'BRIDGE-14-A')
     or (select status from public.client_requests where id = 'b1d9e000-0000-4000-8000-000000000062')
       = 'umgewandelt'
     or pg_temp.assessment_counts() <> v_written
  then raise exception 'a refused conversion left the job, converted the request or wrote history'; end if;

  -- With the assessment of exactly its visit, the conversion records it with the reason.
  v_job := pg_temp.convert_request('b1d9e000-0000-4000-8000-000000000010', v_crew,
    pg_temp.visit_assessment(pg_temp.day(21), '08:00', 60, v_crew, '  Bea kommt vor dem Urlaub  '));
  if pg_temp.crew(pg_temp.legacy_visit(v_job.id)) <> v_crew
     or (select status from public.client_requests where id = 'b1d9e000-0000-4000-8000-000000000062')
       <> 'umgewandelt'
     or not exists (
       select 1 from public.planning_occurrence_assessments
       where occurrence_id = pg_temp.legacy_visit(v_job.id)
         and override_reason = 'Bea kommt vor dem Urlaub'
         and created_by = v_anna
     )
  then raise exception 'a confirmed conversion did not record its visit''s assessment with the reason'; end if;
  perform pg_temp.assert_bridge('a conversion with a visit assessment');

  -- A job for Anna and Bea, whose visit a calendar move left to Anna alone, is parked.
  v_job := public.create_job_with_assignments(
    'b1d9e000-0000-4000-8000-000000000010', v_anna,
    jsonb_build_object('title', 'Speicher tauschen', 'job_number', 'BRIDGE-14-B',
      'planned_date', pg_temp.day(20), 'planned_time', '07:00', 'estimated_duration_minutes', 60),
    v_crew, pg_temp.day(20), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false);
  v_visit := pg_temp.legacy_visit(v_job.id);
  perform public.update_planning_occurrence(
    'b1d9e000-0000-4000-8000-000000000010', v_anna, v_visit,
    pg_temp.version_of(v_visit), pg_temp.timed_item(v_job.id, pg_temp.day(20), '07:00', 60),
    jsonb_build_array(jsonb_build_object('employeeRecordId', pg_temp.record_of(v_anna))),
    '{}', 'capacity', '{}', 'qualification');
  perform public.park_work_target('b1d9e000-0000-4000-8000-000000000010', v_anna, 'job', v_job.id, 0,
    'material', null, pg_temp.record_of(v_anna), pg_temp.day(25));

  -- Unparking it with people needs the assessment of the visit with the whole
  -- team: Anna's alone is stale, and a foreign organization reaches no job.
  v_written := pg_temp.assessment_counts();
  begin
    perform pg_temp.unpark('b1d9e000-0000-4000-8000-000000000010', v_job.id, v_crew, null);
    raise exception 'a parked job was planned with people without the visit''s assessment';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  begin
    perform pg_temp.unpark('b1d9e000-0000-4000-8000-000000000010', v_job.id, v_crew,
      pg_temp.visit_assessment(pg_temp.day(22), '09:00', 60, pg_temp.users(v_anna::text), 'Nur Anna'));
    raise exception 'a parked job was planned with an assessment that misses the team the unpark adds';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  begin
    perform pg_temp.unpark('b1d9e000-0000-4000-8000-000000000011', v_job.id, v_crew,
      pg_temp.visit_assessment(pg_temp.day(22), '09:00', 60, v_crew, 'Fremde Organisation'));
    raise exception 'an unpark reached a job of another organization';
  exception when others then
    if sqlerrm <> 'job_not_found' then raise; end if;
  end;
  select * into v_job from public.jobs where id = v_job.id;
  if v_job.status <> 'geparkt'
     or v_job.planned_date is not null
     or (select status from public.planning_occurrences where id = v_visit) <> 'cancelled'
     or pg_temp.assessment_counts() <> v_written
  then raise exception 'a refused unpark planned the job, revived its visit or wrote history'; end if;

  -- The confirmed unpark plans the visit for the whole team and records its assessment.
  perform pg_temp.unpark('b1d9e000-0000-4000-8000-000000000010', v_job.id, v_crew,
    pg_temp.visit_assessment(pg_temp.day(22), '09:00', 60, v_crew, 'Material ist da'));
  if (select status from public.planning_occurrences where id = v_visit) <> 'scheduled'
     or pg_temp.crew(v_visit) <> v_crew
     or not exists (
       select 1 from public.planning_occurrence_assessments
       where occurrence_id = v_visit and override_reason = 'Material ist da'
     )
  then raise exception 'a confirmed unpark did not plan the whole team or record the visit''s assessment'; end if;
  perform pg_temp.assert_bridge('an unpark with a visit assessment');

  -- Planned again for today, all day, for Anna alone: the visit has started,
  -- so it keeps Bea, and the unpark still needs the assessment of that visit.
  perform public.park_work_target('b1d9e000-0000-4000-8000-000000000010', v_anna, 'job', v_job.id,
    (select execution_version from public.jobs where id = v_job.id),
    'material', null, pg_temp.record_of(v_anna), pg_temp.day(25));
  select blocker.version into v_blocker_version from public.work_blockers blocker
  where blocker.job_id = v_job.id and blocker.kind = 'parking' and blocker.state = 'open';
  v_written := pg_temp.assessment_counts();
  begin
    perform public.unpark_job_into_schedule_with_visit_assessment(
      'b1d9e000-0000-4000-8000-000000000010', v_anna, v_job.id, v_blocker_version, 'Heute eingeplant',
      jsonb_build_object('planned_date', pg_temp.day(0), 'planned_time', null), true,
      pg_temp.users(v_anna::text), pg_temp.day(0), '{}', '[]', '{}', 'fingerprint', null, null, false, null);
    raise exception 'a parked job was planned for today with people without the visit''s assessment';
  exception when others then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  if pg_temp.assessment_counts() <> v_written
     or (select status from public.jobs where id = v_job.id) <> 'geparkt'
  then raise exception 'a refused unpark for today planned the job or wrote history'; end if;
  perform public.unpark_job_into_schedule_with_visit_assessment(
    'b1d9e000-0000-4000-8000-000000000010', v_anna, v_job.id, v_blocker_version, 'Heute eingeplant',
    jsonb_build_object('planned_date', pg_temp.day(0), 'planned_time', null), true,
    pg_temp.users(v_anna::text), pg_temp.day(0), '{}', '[]', '{}', 'fingerprint', null, null, false,
    pg_temp.visit_assessment(pg_temp.day(0), '00:00', 0, v_crew, 'Heute dringend')
      || jsonb_build_object('start_at', null, 'end_at', null,
        'start_date', pg_temp.day(0), 'end_date_exclusive', pg_temp.day(1)));
  if pg_temp.crew(v_visit) <> v_crew
     or not exists (
       select 1 from public.planning_occurrence_assessments
       where occurrence_id = v_visit and override_reason = 'Heute dringend'
     )
  then raise exception 'a confirmed unpark for today did not record the started visit''s assessment'; end if;
end;
$$;

-- 15. A leaver's open work goes to the people the office picks
-- (20261129100000). Per job, the leaver's visits from the handover date on
-- go to the target and the target joins the team; a visit before that date
-- keeps the leaver on it and on the team. Work without a visit leaves the
-- team to the target. A foreign organization, a target outside it, the
-- leaver as target, a field worker, a past date, an unassessed or changed
-- visit and a person without a login for team-only work change nothing.
create function pg_temp.handover_state() returns text language sql as $$
  select concat_ws(' | ',
    (select string_agg(format('%s:%s', assignment.job_id, assignment.user_id), ',' order by assignment.job_id, assignment.user_id)
     from public.job_assignments assignment
     where assignment.job_id in (pg_temp.bridge_id('handover job'), pg_temp.bridge_id('handover parked job'))),
    (select string_agg(format('%s:%s:%s', occurrence.id, occurrence.version, assignment.employee_record_id), ','
       order by occurrence.id, assignment.employee_record_id)
     from public.planning_occurrences occurrence
     join public.planning_occurrence_assignments assignment on assignment.occurrence_id = occurrence.id
     where occurrence.job_id = pg_temp.bridge_id('handover job')),
    (select count(*)::text from public.planning_events where event_type = 'reassigned'),
    (select count(*)::text from public.employee_record_events where event_type = 'work_handed_over'),
    array_to_string(pg_temp.assessment_counts(), ',')
  );
$$;
grant execute on function pg_temp.handover_state() to service_role;

do $$
declare
  v_job uuid := gen_random_uuid();
  v_parked uuid := gen_random_uuid();
  v_foreign_job uuid := gen_random_uuid();
  v_foreign_record uuid := gen_random_uuid();
  v_gone uuid := gen_random_uuid();
  v_early jsonb := pg_temp.timed_item(v_job, pg_temp.day(2), '08:00', 60);
  v_late jsonb := pg_temp.timed_item(v_job, pg_temp.day(10), '08:00', 60);
  v_ids uuid[];
  v_late_id uuid;
  v_bea uuid := pg_temp.record_of('b1d9e000-0000-4000-8000-000000000002');
  v_cem uuid := pg_temp.record_of('b1d9e000-0000-4000-8000-000000000003');
  v_nora uuid := 'b1d9e000-0000-4000-8000-000000000029';
  v_assessed jsonb;
  v_before text;
  v_handed integer;
begin
  insert into public.jobs (id, organization_id, job_number, title, status, created_by) values
    (v_job, 'b1d9e000-0000-4000-8000-000000000010', 'BRIDGE-H1', 'Übergabe Wartung', 'nicht_bearbeitet',
     'b1d9e000-0000-4000-8000-000000000001'),
    (v_parked, 'b1d9e000-0000-4000-8000-000000000010', 'BRIDGE-H2', 'Übergabe Parkplatz', 'geparkt',
     'b1d9e000-0000-4000-8000-000000000001'),
    (v_foreign_job, 'b1d9e000-0000-4000-8000-000000000011', 'BRIDGE-HF', 'Fremde Übergabe', 'nicht_bearbeitet',
     'b1d9e000-0000-4000-8000-000000000004');
  insert into public.employee_records (id, organization_id, first_name, last_name) values
    (v_foreign_record, 'b1d9e000-0000-4000-8000-000000000011', 'Fremd', 'Ziel');
  insert into bridge_ids values ('handover job', v_job), ('handover parked job', v_parked);
  insert into public.job_assignments (job_id, user_id, assigned_by) values
    (v_parked, 'b1d9e000-0000-4000-8000-000000000002', 'b1d9e000-0000-4000-8000-000000000001');
  v_ids := public.create_planning_entry_materialized(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', null,
    jsonb_build_array(v_early), jsonb_build_array(pg_temp.assignment(v_early, 'b1d9e000-0000-4000-8000-000000000002')),
    gen_random_uuid(), '{}', 'capacity', '{}', 'qualification');
  insert into bridge_ids values ('handover early visit', v_ids[1]);
  v_ids := public.create_planning_entry_materialized(
    'b1d9e000-0000-4000-8000-000000000010', 'b1d9e000-0000-4000-8000-000000000001', null,
    jsonb_build_array(v_late), jsonb_build_array(pg_temp.assignment(v_late, 'b1d9e000-0000-4000-8000-000000000002')),
    gen_random_uuid(), '{}', 'capacity', '{}', 'qualification');
  v_late_id := v_ids[1];
  -- What the server assessed: the late visit, at its version, with Cem instead of Bea.
  v_assessed := jsonb_build_array(jsonb_build_object(
    'jobId', v_job, 'capacitySnapshot', '{}'::jsonb, 'capacityFingerprint', 'capacity',
    'qualificationSnapshot', '{}'::jsonb, 'qualificationFingerprint', 'qualification',
    'visits', jsonb_build_array(jsonb_build_object(
      'occurrenceId', v_late_id, 'version', pg_temp.version_of(v_late_id), 'employeeRecordIds', jsonb_build_array(v_cem)))));
  v_before := pg_temp.handover_state();

  -- Each refusal leaves every row as it was.
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000011',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_cem)), v_assessed, null);
    raise exception 'a handover in a foreign organization was accepted';
  exception when raise_exception then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000003', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_cem)), v_assessed, null);
    raise exception 'a field worker handed over a colleague''s work';
  exception when raise_exception then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_foreign_record)), v_assessed, null);
    raise exception 'a target outside the organization took over work';
  exception when raise_exception then
    if sqlerrm <> 'target_not_found' then raise; end if;
  end;
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_foreign_job, 'targetEmployeeRecordId', v_cem)), '[]', null);
    raise exception 'a foreign organization''s job was handed over';
  exception when raise_exception then
    if sqlerrm <> 'job_not_found' then raise; end if;
  end;
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_foreign_record, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_cem)), v_assessed, null);
    raise exception 'a foreign organization''s person had their work handed over';
  exception when raise_exception then
    if sqlerrm <> 'employee_record_not_found' then raise; end if;
  end;
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_bea)), v_assessed, null);
    raise exception 'the leaver took over their own work';
  exception when raise_exception then
    if sqlerrm <> 'invalid_target' then raise; end if;
  end;
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(-1),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_cem)), v_assessed, null);
    raise exception 'a handover from yesterday was accepted';
  exception when raise_exception then
    if sqlerrm <> 'invalid_handover_date' then raise; end if;
  end;
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5), '[]', '[]', null);
    raise exception 'a handover without a job was accepted';
  exception when raise_exception then
    if sqlerrm <> 'invalid_handover' then raise; end if;
  end;
  insert into public.employee_records (id, organization_id, first_name, last_name, exit_date) values
    (v_gone, 'b1d9e000-0000-4000-8000-000000000010', 'Gerd', 'Gegangen', pg_temp.day(3));
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_gone)), v_assessed, null);
    raise exception 'a target who leaves before the handover date took over work';
  exception when raise_exception then
    if sqlerrm <> 'target_not_available' then raise; end if;
  end;
  -- Without the assessment of the visit it moves, or for an older version of it.
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_cem)), '[]', null);
    raise exception 'an unassessed visit was handed over';
  exception when raise_exception then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_cem)),
      jsonb_set(v_assessed, '{0,visits,0,version}', to_jsonb(pg_temp.version_of(v_late_id) - 1)), null);
    raise exception 'a visit changed since its assessment was handed over';
  exception when raise_exception then
    if sqlerrm <> 'stale_planning_occurrence' then raise; end if;
  end;
  -- A refused later row rolls back the earlier one: Nora has no login for the parked job's team.
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(
        jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_cem),
        jsonb_build_object('jobId', v_parked, 'targetEmployeeRecordId', v_nora)),
      v_assessed, null);
    raise exception 'team-only work went to a person without a login';
  exception when raise_exception then
    if sqlerrm <> 'target_without_login' then raise; end if;
  end;
  if pg_temp.handover_state() <> v_before then
    raise exception 'a refused handover changed rows: % became %', v_before, pg_temp.handover_state();
  end if;

  v_handed := public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
    'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
    jsonb_build_array(
      jsonb_build_object('jobId', v_job, 'targetEmployeeRecordId', v_cem),
      jsonb_build_object('jobId', v_parked, 'targetEmployeeRecordId', v_cem)),
    v_assessed, 'Übergabe vor dem Austritt');
  if v_handed <> 2 then raise exception 'the handover reported % jobs, not 2', v_handed; end if;
  if pg_temp.crew(v_late_id) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000003') then
    raise exception 'the visit after the handover date did not go to Cem';
  end if;
  if pg_temp.crew(pg_temp.bridge_id('handover early visit')) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000002') then
    raise exception 'the visit before the handover date left Bea';
  end if;
  if pg_temp.team(v_job) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000002', 'b1d9e000-0000-4000-8000-000000000003') then
    raise exception 'the job''s team is not Bea, who keeps an earlier visit, and Cem';
  end if;
  if pg_temp.team(v_parked) <> pg_temp.users('b1d9e000-0000-4000-8000-000000000003') then
    raise exception 'the parked job''s team did not go from Bea to Cem';
  end if;
  if not exists (
    select 1 from public.planning_events
    where occurrence_id = v_late_id and event_type = 'reassigned' and reason = 'Übergabe vor dem Austritt'
  ) or not exists (
    select 1 from public.planning_occurrence_assessments
    where occurrence_id = v_late_id and override_reason = 'Übergabe vor dem Austritt'
      and selected_employee_record_ids = array[v_cem]
  ) then raise exception 'the moved visit has no reassignment event or assessment with the reason'; end if;
  if not exists (
    select 1 from public.employee_record_events
    where employee_record_id = v_bea and event_type = 'work_handed_over'
      and jsonb_array_length(event_payload->'jobs') = 2
  ) then raise exception 'Bea''s personnel history does not record the handover'; end if;
  perform pg_temp.assert_bridge('a handover');

  -- The same handover again finds nothing of Bea's on the parked job.
  begin
    perform public.hand_over_personnel_work('b1d9e000-0000-4000-8000-000000000010',
      'b1d9e000-0000-4000-8000-000000000001', v_bea, pg_temp.day(5),
      jsonb_build_array(jsonb_build_object('jobId', v_parked, 'targetEmployeeRecordId', v_cem)), '[]', null);
    raise exception 'a job Bea no longer holds was handed over again';
  exception when raise_exception then
    if sqlerrm <> 'stale_handover' then raise; end if;
  end;
end;
$$;

-- 16. The open absences the attention tasks read in one call (20261129100000):
-- the vacation requests the old table read returned (pending, or approved and
-- ending today or later, by start date), and each person who left with an
-- unstarted visit after the exit, from the day after it. Another
-- organization's rows never come back.
do $$
declare
  v_anna uuid := pg_temp.record_of('b1d9e000-0000-4000-8000-000000000001');
  v_bea uuid := pg_temp.record_of('b1d9e000-0000-4000-8000-000000000002');
  v_cem uuid := pg_temp.record_of('b1d9e000-0000-4000-8000-000000000003');
  v_foreign_record uuid := gen_random_uuid();
  v_result jsonb;
  v_expected jsonb;
begin
  insert into public.employee_records (id, organization_id, first_name, last_name) values
    (v_foreign_record, 'b1d9e000-0000-4000-8000-000000000011', 'Fremd', 'Urlaub');
  insert into public.vacation_requests (id, organization_id, employee_record_id, start_date, end_date, status) values
    ('b1d9e000-0000-4000-8000-0000000000a1', 'b1d9e000-0000-4000-8000-000000000010', v_anna,
     pg_temp.day(20), pg_temp.day(21), 'pending'),
    ('b1d9e000-0000-4000-8000-0000000000a2', 'b1d9e000-0000-4000-8000-000000000010', v_bea,
     pg_temp.day(-3), pg_temp.day(0), 'approved'),
    ('b1d9e000-0000-4000-8000-0000000000a3', 'b1d9e000-0000-4000-8000-000000000010', v_cem,
     pg_temp.day(-10), pg_temp.day(-5), 'approved'),
    ('b1d9e000-0000-4000-8000-0000000000a4', 'b1d9e000-0000-4000-8000-000000000010', v_anna,
     pg_temp.day(30), pg_temp.day(30), 'rejected'),
    ('b1d9e000-0000-4000-8000-0000000000a5', 'b1d9e000-0000-4000-8000-000000000011', v_foreign_record,
     pg_temp.day(20), pg_temp.day(21), 'pending');
  -- Cem holds the handed-over visit ten days ahead and leaves before it; Bea
  -- leaves after all her visits, which stay her work.
  update public.employee_records set exit_date = pg_temp.day(4) where id = v_cem;
  update public.employee_records set exit_date = pg_temp.day(2000) where id = v_bea;

  v_result := public.read_open_absences('b1d9e000-0000-4000-8000-000000000010', pg_temp.day(0));
  select coalesce(jsonb_agg(to_jsonb(request) order by request.start_date, request.id), '[]'::jsonb)
  into v_expected
  from public.vacation_requests request
  where request.organization_id = 'b1d9e000-0000-4000-8000-000000000010'
    and (request.status = 'pending' or (request.status = 'approved' and request.end_date >= pg_temp.day(0)));
  if v_result->'vacations' <> v_expected
     or (select array_agg(value->>'id') from jsonb_array_elements(v_result->'vacations'))
       <> array['b1d9e000-0000-4000-8000-0000000000a2', 'b1d9e000-0000-4000-8000-0000000000a1'] then
    raise exception 'the open vacations differ from the rows the table read returned: %', v_result->'vacations';
  end if;
  if v_result->'leaverWindows'
     <> jsonb_build_array(jsonb_build_object('employeeRecordId', v_cem, 'from', pg_temp.day(5))) then
    raise exception 'the leaver windows are not Cem from the day after the exit: %', v_result->'leaverWindows';
  end if;
  -- An exit long past still counts from today.
  update public.employee_records set entry_date = pg_temp.day(-60), exit_date = pg_temp.day(-30) where id = v_cem;
  if public.read_open_absences('b1d9e000-0000-4000-8000-000000000010', pg_temp.day(0))->'leaverWindows'
     <> jsonb_build_array(jsonb_build_object('employeeRecordId', v_cem, 'from', pg_temp.day(0))) then
    raise exception 'a past exit did not count from today';
  end if;
  v_result := public.read_open_absences('b1d9e000-0000-4000-8000-000000000011', pg_temp.day(0));
  if (select array_agg(value->>'id') from jsonb_array_elements(v_result->'vacations'))
       <> array['b1d9e000-0000-4000-8000-0000000000a5']
     or v_result->'leaverWindows' <> '[]'::jsonb then
    raise exception 'another organization''s absences came back: %', v_result;
  end if;
end;
$$;

reset role;

-- One owner sets the marker and every job-to-plan trigger reads it. A second
-- writer would be a second place to forget the restore.
do $$
declare
  v_writers text;
  v_reader text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_writers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private')
    and p.prosrc ~ 'set_config\(\s*''app\.planning_projection_write''';
  if v_writers is distinct from 'app_private.project_plan_onto_job(uuid,uuid,uuid,uuid[])' then
    raise exception 'the projection marker has writers other than app_private.project_plan_onto_job: %', v_writers;
  end if;
  foreach v_reader in array array[
    'app_private.sync_legacy_job_planning_occurrence()', 'app_private.sync_legacy_job_assignment()'
  ] loop
    if (select prosrc from pg_proc where oid = v_reader::regprocedure)
       !~ 'current_setting\(''app\.planning_projection_write'', true\) = ''true'''
    then raise exception '% no longer stays quiet during a projection', v_reader; end if;
  end loop;
end;
$$;

-- Only the service role executes the bridge's functions.
do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'app_private.project_plan_onto_job(uuid, uuid, uuid, uuid[])',
    'public.create_planning_entry_materialized(uuid, uuid, jsonb, jsonb, jsonb, uuid, jsonb, text, jsonb, text, text)',
    'public.extend_planning_series_materialization(uuid, uuid, uuid, timestamp without time zone, jsonb, jsonb, jsonb, text, jsonb, text, text)',
    'public.reschedule_planning_series(uuid, uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, text, jsonb, text, text)',
    'public.update_planning_occurrence(uuid, uuid, uuid, integer, jsonb, jsonb, jsonb, text, jsonb, text, text)',
    'public.batch_reschedule_planning_occurrences(uuid, uuid, uuid, text, jsonb, jsonb, text, jsonb, text, text)',
    'public.set_planning_occurrence_status(uuid, uuid, uuid, integer, planning_occurrence_status, text)',
    'public.replace_job_assignments_with_assessment(uuid, uuid, uuid[], uuid, date, uuid[], jsonb, jsonb, text, text, uuid, boolean)',
    'public.replace_job_assignments_with_visit_assessment(uuid, uuid, uuid[], uuid, date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid[], uuid, integer, jsonb, text, jsonb, text, text)',
    'public.update_job_with_assignments(uuid, uuid, uuid, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean)',
    'public.create_job_with_visit_assessment(uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, jsonb)',
    'public.update_job_with_visit_assessment(uuid, uuid, uuid, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, jsonb)',
    'public.convert_client_request_to_job_with_visit_assessment(uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, jsonb)',
    'public.unpark_job_into_schedule_with_visit_assessment(uuid, uuid, uuid, bigint, text, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, jsonb)',
    'app_private.record_job_visit_assessment(uuid, uuid, uuid, integer, uuid[], jsonb)',
    'app_private.record_job_visit_assessment(uuid, uuid, uuid, integer, uuid[], jsonb, boolean)',
    'public.hand_over_personnel_work(uuid, uuid, uuid, date, jsonb, jsonb, text)',
    'public.read_open_absences(uuid, date)'
  ] loop
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
  end loop;
  foreach v_function in array array[
    'app_private.sync_legacy_job_assignment()', 'app_private.sync_legacy_job_planning_occurrence()',
    'app_private.sync_job_status_from_planning_occurrences()'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
end;
$$;

rollback;
