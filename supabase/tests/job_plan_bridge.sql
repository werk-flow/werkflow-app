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
-- 20261006100100).
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
    'public.update_job_with_assignments(uuid, uuid, uuid, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean)'
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
