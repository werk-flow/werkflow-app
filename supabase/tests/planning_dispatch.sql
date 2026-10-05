-- P1-12 dispatch facts behind the browser journeys: an acknowledgement is only
-- "seen and accepted", a moved visit keeps its customer commitment and
-- invalidates the acknowledgement, a batch move is all or nothing with
-- per-visit history, and dispatch rows stay private to managers, recipients
-- and their organization.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('77000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'planning-dispatch-admin@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Admin","last_name":"Einsatz"}'::jsonb, now(), now()),
('77000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'planning-dispatch-employee@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Emil","last_name":"Einsatz"}'::jsonb, now(), now()),
('77000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'planning-dispatch-outsider@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Fremd","last_name":"Einsatz"}'::jsonb, now(), now()),
('77000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'planning-dispatch-colleague@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Kai","last_name":"Einsatz"}'::jsonb, now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('77000000-0000-4000-8000-000000000010', 'Planning dispatch',
 '77000000-0000-4000-8000-000000000001', 'PLANDISA'),
('77000000-0000-4000-8000-000000000011', 'Other planning dispatch',
 '77000000-0000-4000-8000-000000000003', 'PLANDISB');
insert into public.organization_members (organization_id, user_id, role) values
('77000000-0000-4000-8000-000000000010', '77000000-0000-4000-8000-000000000002', 'employee'),
('77000000-0000-4000-8000-000000000010', '77000000-0000-4000-8000-000000000004', 'employee');
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('77000000-0000-4000-8000-000000000020', '77000000-0000-4000-8000-000000000010',
 'Hauptbesuch', 'DIS-0001', '77000000-0000-4000-8000-000000000001'),
('77000000-0000-4000-8000-000000000021', '77000000-0000-4000-8000-000000000010',
 'Serienbesuch', 'DIS-0002', '77000000-0000-4000-8000-000000000001'),
('77000000-0000-4000-8000-000000000022', '77000000-0000-4000-8000-000000000010',
 'Begonnener Besuch', 'DIS-0003', '77000000-0000-4000-8000-000000000001'),
('77000000-0000-4000-8000-000000000023', '77000000-0000-4000-8000-000000000010',
 'Ungeplanter Auftrag', 'DIS-0004', '77000000-0000-4000-8000-000000000001');

create function pg_temp.timed_item(job_id uuid, local_day date, local_time time)
returns jsonb language sql as $$
  select jsonb_build_object(
    'jobId', job_id, 'entryKind', 'job_visit', 'timeKind', 'timed',
    'originalStartLocal', to_char(local_day, 'YYYY-MM-DD') || 'T' || to_char(local_time, 'HH24:MI'),
    'startAt', (local_day + local_time) at time zone 'Europe/Berlin',
    'endAt', (local_day + local_time + interval '1 hour') at time zone 'Europe/Berlin'
  );
$$;

create function pg_temp.assignment(local_day date, local_time time, employee_record uuid)
returns jsonb language sql as $$
  select jsonb_build_object(
    'occurrenceOriginalStartLocal', to_char(local_day, 'YYYY-MM-DD') || 'T' || to_char(local_time, 'HH24:MI'),
    'employeeRecordId', employee_record
  );
$$;

create function pg_temp.batch_item(occurrence_id uuid, local_day date, local_time time)
returns jsonb language sql as $$
  select jsonb_build_object(
    'occurrenceId', occurrence_id,
    'expectedVersion', (select version from public.planning_occurrences where id = occurrence_id),
    'startAt', (local_day + local_time) at time zone 'Europe/Berlin',
    'endAt', (local_day + local_time + interval '1 hour') at time zone 'Europe/Berlin'
  );
$$;

set local role service_role;

do $$
declare
  org constant uuid := '77000000-0000-4000-8000-000000000010';
  admin_user constant uuid := '77000000-0000-4000-8000-000000000001';
  employee_user constant uuid := '77000000-0000-4000-8000-000000000002';
  main_job constant uuid := '77000000-0000-4000-8000-000000000020';
  visit_day constant date := (now() at time zone 'Europe/Berlin')::date + 5;
  employee_record uuid;
  main_occurrence uuid;
  main_dispatch uuid;
begin
  select id into employee_record from public.employee_records
  where organization_id = org and user_id = employee_user;
  if employee_record is null then raise exception 'employee record prerequisite missing'; end if;

  main_occurrence := (public.create_planning_entry_materialized(
    org, admin_user, null, jsonb_build_array(pg_temp.timed_item(main_job, visit_day, '06:00')),
    jsonb_build_array(pg_temp.assignment(visit_day, '06:00', employee_record)),
    '77000000-0000-4000-8000-000000000030', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  ))[1];
  if not exists (select 1 from public.planning_occurrence_assignments
                 where occurrence_id = main_occurrence and employee_record_id = employee_record)
    then raise exception 'the planned visit has no recipient'; end if;

  main_dispatch := public.issue_planning_dispatch(
    org, admin_user, main_occurrence, null, null, 'Schlüssel beim Hausmeister.', '{}'::jsonb,
    repeat('a', 64), '77000000-0000-4000-8000-000000000031'
  );
  if public.acknowledge_planning_dispatch(org, employee_user, main_dispatch, 1) <> 'acknowledged'
    then raise exception 'the recipient could not acknowledge the dispatch'; end if;
  if exists (select 1 from public.time_entries where organization_id = org)
     or exists (select 1 from public.planning_customer_commitments where organization_id = org)
    then raise exception 'an acknowledgement created actual time or a customer commitment'; end if;

  perform public.record_customer_commitment(
    org, admin_user, main_occurrence, visit_day, '06:00', '08:00', 'vor_ort'
  );

  -- A material move supersedes the acknowledged revision and never touches the promise.
  perform public.update_planning_occurrence(
    org, admin_user, main_occurrence,
    (select version from public.planning_occurrences where id = main_occurrence),
    pg_temp.timed_item(main_job, visit_day + 1, '06:00'),
    jsonb_build_array(jsonb_build_object('employeeRecordId', employee_record)),
    '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
end;
$$;

-- The dispatch synchronisation runs in deferred triggers at commit. Fire the
-- pending ones now, as a commit would, so the rolled-back test can observe them.
set constraints all immediate;
set constraints all deferred;

do $$
declare
  org constant uuid := '77000000-0000-4000-8000-000000000010';
  admin_user constant uuid := '77000000-0000-4000-8000-000000000001';
  employee_user constant uuid := '77000000-0000-4000-8000-000000000002';
  colleague_user constant uuid := '77000000-0000-4000-8000-000000000004';
  main_job constant uuid := '77000000-0000-4000-8000-000000000020';
  series_job constant uuid := '77000000-0000-4000-8000-000000000021';
  started_job constant uuid := '77000000-0000-4000-8000-000000000022';
  unscheduled_job constant uuid := '77000000-0000-4000-8000-000000000023';
  visit_day constant date := (now() at time zone 'Europe/Berlin')::date + 5;
  employee_record uuid;
  colleague_record uuid;
  main_dispatch uuid;
  colleague_dispatch_id uuid;
  commitment_id uuid;
  series_occurrences uuid[];
  started_occurrence uuid;
  series_id_before uuid;
  starts_before timestamptz[];
  batch_request constant uuid := '77000000-0000-4000-8000-000000000040';
  moved uuid[];
  refused boolean;
begin
  select id into employee_record from public.employee_records
  where organization_id = org and user_id = employee_user;
  select id into colleague_record from public.employee_records
  where organization_id = org and user_id = colleague_user;
  if colleague_record is null then raise exception 'colleague record prerequisite missing'; end if;
  select dispatch.id into main_dispatch from public.planning_dispatches dispatch
  join public.planning_occurrences occurrence on occurrence.id = dispatch.occurrence_id
  where occurrence.job_id = main_job;
  select commitment.id into commitment_id from public.planning_customer_commitments commitment
  join public.planning_occurrences occurrence on occurrence.id = commitment.occurrence_id
  where occurrence.job_id = main_job;

  if (select array_agg(change_kind::text order by revision_number) from public.planning_dispatch_revisions
      where dispatch_id = main_dispatch) is distinct from array['issued', 'schedule_changed']
     or exists (select 1 from public.planning_dispatch_acknowledgements acknowledgement
                join public.planning_dispatches dispatch on dispatch.current_revision_id = acknowledgement.revision_id
                where dispatch.id = main_dispatch)
    then raise exception 'a moved visit kept a valid acknowledgement'; end if;
  if (select committed_date from public.planning_customer_commitments where id = commitment_id) <> visit_day
     or (select status::text from public.planning_customer_commitments where id = commitment_id) <> 'active'
    then raise exception 'moving the visit changed the customer commitment'; end if;
  if exists (select 1 from public.time_entries where organization_id = org)
    then raise exception 'dispatch, commitment or move created actual time'; end if;

  -- A second dispatch for a colleague only: the employee must not see it.
  colleague_dispatch_id := public.issue_planning_dispatch(
    org, admin_user, null, unscheduled_job, array[colleague_record], null, '{}'::jsonb,
    repeat('a', 64), '77000000-0000-4000-8000-000000000032'
  );
  if colleague_dispatch_id is null then raise exception 'the colleague dispatch was not issued'; end if;

  -- Batch: a series of two plus one already started visit.
  series_occurrences := public.create_planning_entry_materialized(
    org, admin_user,
    jsonb_build_object(
      'jobId', series_job, 'entryKind', 'job_visit', 'timeKind', 'timed',
      'startsAtLocal', to_char(visit_day + 3, 'YYYY-MM-DD') || 'T06:00',
      'segmentStartLocal', to_char(visit_day + 3, 'YYYY-MM-DD') || 'T06:00',
      'durationMinutes', 60, 'frequency', 'daily', 'interval', 1, 'occurrenceCount', 2
    ),
    jsonb_build_array(pg_temp.timed_item(series_job, visit_day + 3, '06:00'),
                      pg_temp.timed_item(series_job, visit_day + 4, '06:00')),
    jsonb_build_array(pg_temp.assignment(visit_day + 3, '06:00', employee_record),
                      pg_temp.assignment(visit_day + 4, '06:00', employee_record)),
    '77000000-0000-4000-8000-000000000033', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  started_occurrence := (public.create_planning_entry_materialized(
    org, admin_user, null,
    jsonb_build_array(jsonb_build_object(
      'jobId', started_job, 'entryKind', 'job_visit', 'timeKind', 'timed',
      'startAt', now() - interval '30 minutes', 'endAt', now() + interval '30 minutes'
    )),
    '[]'::jsonb, '77000000-0000-4000-8000-000000000034',
    '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  ))[1];
  select series_id into series_id_before from public.planning_occurrences where id = series_occurrences[1];
  select array_agg(start_at order by original_start_local) into starts_before
  from public.planning_occurrences where id = any(series_occurrences);

  begin
    perform public.batch_reschedule_planning_occurrences(
      org, admin_user, '77000000-0000-4000-8000-000000000041', 'Umplanung der Einsatzwoche.',
      jsonb_build_array(pg_temp.batch_item(series_occurrences[1], visit_day + 4, '08:00'),
                        pg_temp.batch_item(started_occurrence, visit_day + 4, '09:00')),
      '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
    );
    refused := false;
  exception when others then refused := sqlerrm like 'batch_item_started:%';
  end;
  if not refused
     or (select array_agg(start_at order by original_start_local) from public.planning_occurrences
         where id = any(series_occurrences)) is distinct from starts_before
    then raise exception 'a batch with a started visit moved part of the selection'; end if;

  moved := public.batch_reschedule_planning_occurrences(
    org, admin_user, batch_request, 'Umplanung der Einsatzwoche.',
    jsonb_build_array(pg_temp.batch_item(series_occurrences[1], visit_day + 4, '08:00'),
                      pg_temp.batch_item(series_occurrences[2], visit_day + 5, '08:00')),
    '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification', 'Betrieblich abgestimmt.'
  );
  if exists (select 1 from public.planning_occurrences
             where id = any(series_occurrences)
               and (not is_exception or series_id is distinct from series_id_before
                    or (start_at at time zone 'Europe/Berlin')::time <> '08:00'))
    then raise exception 'batch-moved series visits are not exceptions of their series'; end if;
  if (select count(distinct occurrence_id) from public.planning_events
      where occurrence_id = any(series_occurrences) and event_type = 'edited'
        and after_state ->> 'batchRequestId' = batch_request::text) <> 2
     or (select count(*) from public.planning_events
         where organization_id = org and event_type = 'batch_rescheduled'
           and after_state ->> 'requestId' = batch_request::text
           and (select array_agg(value::uuid order by value) from jsonb_array_elements_text(after_state -> 'occurrenceIds'))
               = (select array_agg(id order by id::text) from unnest(moved) id)) <> 1
    then raise exception 'the batch move lost per-visit history or its atomic marker'; end if;
end;
$$;

-- Visibility: the recipient sees their own dispatch and acknowledgement but no
-- dispatch history, commitments or a colleague's dispatch; another
-- organization sees nothing.
set local role authenticated;
select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000002', true);
do $$
declare
  org constant uuid := '77000000-0000-4000-8000-000000000010';
begin
  if (select count(*) from public.planning_dispatches where organization_id = org) <> 1
     or (select count(*) from public.planning_dispatch_acknowledgements where organization_id = org) <> 1
    then raise exception 'the recipient did not see exactly their own dispatch'; end if;
  if exists (select 1 from public.planning_dispatch_events where organization_id = org)
     or exists (select 1 from public.planning_customer_commitments where organization_id = org)
     or exists (select 1 from public.planning_customer_commitment_events where organization_id = org)
    then raise exception 'the recipient could read dispatch history or customer commitments'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000001', true);
do $$
declare
  org constant uuid := '77000000-0000-4000-8000-000000000010';
begin
  if (select count(*) from public.planning_dispatches where organization_id = org) <> 2
     or not exists (select 1 from public.planning_dispatch_events where organization_id = org)
     or (select count(*) from public.planning_customer_commitments where organization_id = org) <> 1
    then raise exception 'a manager did not see the organization dispatch state'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000003', true);
do $$
declare
  org constant uuid := '77000000-0000-4000-8000-000000000010';
begin
  if exists (select 1 from public.planning_dispatches where organization_id = org)
     or exists (select 1 from public.planning_dispatch_revisions where organization_id = org)
     or exists (select 1 from public.planning_dispatch_recipients where organization_id = org)
     or exists (select 1 from public.planning_dispatch_acknowledgements where organization_id = org)
     or exists (select 1 from public.planning_dispatch_events where organization_id = org)
     or exists (select 1 from public.planning_customer_commitments where organization_id = org)
    then raise exception 'another organization could read dispatch rows'; end if;
end;
$$;

rollback;
