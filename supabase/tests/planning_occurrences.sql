-- P1-11 occurrence identity, exceptions, protected history, plan-versus-actual
-- separation and planning visibility. The browser journey proves the visible
-- flow; these rules live in the planning RPCs, constraints and policies.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('76000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'planning-occurrences-admin@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Admin","last_name":"Planung"}'::jsonb, now(), now()),
('76000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'planning-occurrences-employee@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Emil","last_name":"Planung"}'::jsonb, now(), now()),
('76000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'planning-occurrences-outsider@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Fremd","last_name":"Planung"}'::jsonb, now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('76000000-0000-4000-8000-000000000010', 'Planning occurrences',
 '76000000-0000-4000-8000-000000000001', 'PLANOCCA'),
('76000000-0000-4000-8000-000000000011', 'Other planning occurrences',
 '76000000-0000-4000-8000-000000000003', 'PLANOCCB');
insert into public.organization_members (organization_id, user_id, role) values
('76000000-0000-4000-8000-000000000010', '76000000-0000-4000-8000-000000000002', 'employee');
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('76000000-0000-4000-8000-000000000020', '76000000-0000-4000-8000-000000000010',
 'Serienbesuch', 'OCC-0001', '76000000-0000-4000-8000-000000000001');

-- Builds one timed materialized occurrence the way the server action does.
create function pg_temp.timed_item(job_id uuid, local_day date, local_time time, minutes integer)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'jobId', job_id,
    'entryKind', case when job_id is null then 'internal' else 'job_visit' end,
    'internalType', case when job_id is null then 'meeting' end,
    'title', case when job_id is null then 'Rückblick' end,
    'timeKind', 'timed',
    'originalStartLocal', to_char(local_day, 'YYYY-MM-DD') || 'T' || to_char(local_time, 'HH24:MI'),
    'identityOriginalStartLocal', to_char(local_day, 'YYYY-MM-DD') || 'T' || to_char(local_time, 'HH24:MI'),
    'startAt', (local_day + local_time) at time zone 'Europe/Berlin',
    'endAt', (local_day + local_time + make_interval(mins => minutes)) at time zone 'Europe/Berlin'
  ));
$$;

create function pg_temp.daily_series(job_id uuid, local_day date, local_time time, day_interval integer, occurrence_count integer)
returns jsonb language sql as $$
  select jsonb_build_object(
    'jobId', job_id,
    'entryKind', case when job_id is null then 'internal' else 'job_visit' end,
    'internalType', case when job_id is null then 'meeting' end,
    'title', case when job_id is null then 'Rückblick' end,
    'timeKind', 'timed',
    'startsAtLocal', to_char(local_day, 'YYYY-MM-DD') || 'T' || to_char(local_time, 'HH24:MI'),
    'segmentStartLocal', to_char(local_day, 'YYYY-MM-DD') || 'T' || to_char(local_time, 'HH24:MI'),
    'durationMinutes', 60, 'frequency', 'daily', 'interval', day_interval,
    'occurrenceCount', occurrence_count
  );
$$;

create function pg_temp.berlin_time(instant timestamptz) returns time language sql as $$
  select (instant at time zone 'Europe/Berlin')::time;
$$;

set local role service_role;

do $$
declare
  org constant uuid := '76000000-0000-4000-8000-000000000010';
  admin_user constant uuid := '76000000-0000-4000-8000-000000000001';
  employee_user constant uuid := '76000000-0000-4000-8000-000000000002';
  job constant uuid := '76000000-0000-4000-8000-000000000020';
  first_day constant date := (now() at time zone 'Europe/Berlin')::date + 10;
  employee_record uuid;
  occurrence_ids uuid[];
  identities_before text[];
  lineage uuid;
  second_id uuid;
  third_id uuid;
  fifth_id uuid;
  exception_start timestamptz;
  next_version integer;
  refused boolean;
begin
  select id into employee_record from public.employee_records
  where organization_id = org and user_id = employee_user;
  if employee_record is null then raise exception 'employee record prerequisite missing'; end if;

  occurrence_ids := public.create_planning_entry_materialized(
    org, admin_user, pg_temp.daily_series(job, first_day, '09:00', 1, 5),
    (select jsonb_agg(pg_temp.timed_item(job, first_day + day, '09:00', 60) order by day)
       from generate_series(0, 4) day),
    (select jsonb_agg(jsonb_build_object(
        'occurrenceOriginalStartLocal', to_char(first_day + day, 'YYYY-MM-DD') || 'T09:00',
        'employeeRecordId', employee_record)) from generate_series(0, 4) day),
    '76000000-0000-4000-8000-000000000030', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  if cardinality(occurrence_ids) <> 5
     or (select count(distinct original_start_local) from public.planning_occurrences
         where id = any(occurrence_ids)) <> 5
     or (select count(distinct series_id) from public.planning_occurrences
         where id = any(occurrence_ids)) <> 1
    then raise exception 'a five-visit series did not create five stable identities in one series'; end if;

  select series_lineage_id into lineage from public.planning_occurrences where id = occurrence_ids[1];
  select array_agg(original_start_local::text order by original_start_local) into identities_before
  from public.planning_occurrences where series_lineage_id = lineage;
  select id into second_id from public.planning_occurrences
  where series_lineage_id = lineage order by original_start_local offset 1 limit 1;
  select id into third_id from public.planning_occurrences
  where series_lineage_id = lineage order by original_start_local offset 2 limit 1;
  select id into fifth_id from public.planning_occurrences
  where series_lineage_id = lineage order by original_start_local offset 4 limit 1;

  -- Series identities are unique per lineage: a repeated extension cannot duplicate a visit.
  begin
    insert into public.planning_occurrences (
      organization_id, series_id, series_lineage_id, original_start_local, job_id,
      entry_kind, time_kind, timezone, start_at, end_at, status, created_by, updated_by
    ) select organization_id, series_id, series_lineage_id, original_start_local, job_id,
      entry_kind, time_kind, timezone, start_at, end_at, 'scheduled', admin_user, admin_user
    from public.planning_occurrences where id = second_id;
    refused := false;
  exception when unique_violation then refused := true;
  end;
  if not refused then raise exception 'a duplicate series identity was accepted'; end if;

  -- "Nur dieser Termin": the visit becomes an exception and keeps its identity.
  next_version := public.update_planning_occurrence(
    org, admin_user, second_id, 1,
    pg_temp.timed_item(job, first_day + 1, '11:00', 60),
    jsonb_build_array(jsonb_build_object('employeeRecordId', employee_record)),
    '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  select start_at into exception_start from public.planning_occurrences where id = second_id;
  if next_version <> 2
     or not (select is_exception from public.planning_occurrences where id = second_id)
     or pg_temp.berlin_time(exception_start) <> '11:00'
     or not exists (select 1 from public.planning_events where occurrence_id = second_id and event_type = 'edited')
    then raise exception 'a single-visit edit did not become a traceable exception'; end if;

  -- "Dieser und zukünftige": the series splits, every identity survives.
  perform public.reschedule_planning_series(
    org, admin_user, third_id, 1, 'future',
    pg_temp.daily_series(job, first_day + 2, '12:00', 1, 3),
    (select jsonb_agg(pg_temp.timed_item(job, first_day + day, '12:00', 60)
       || jsonb_build_object('identityOriginalStartLocal', to_char(first_day + day, 'YYYY-MM-DD') || 'T09:00')
       order by day) from generate_series(2, 4) day),
    jsonb_build_array(jsonb_build_object('employeeRecordId', employee_record)),
    '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  if (select count(*) from public.planning_series where lineage_id = lineage) <> 2
     or (select array_agg(original_start_local::text order by original_start_local)
         from public.planning_occurrences where series_lineage_id = lineage) is distinct from identities_before
     or (select series_id from public.planning_occurrences where id = third_id)
        = (select series_id from public.planning_occurrences where id = second_id)
     or pg_temp.berlin_time((select start_at from public.planning_occurrences where id = fifth_id)) <> '12:00'
     or not exists (select 1 from public.planning_events where occurrence_id = third_id and event_type = 'series_split')
    then raise exception 'a this-and-future edit lost an identity or did not split the series'; end if;

  -- "Ganze Serie": every unchanged future visit moves, the exception keeps its own time.
  perform public.reschedule_planning_series(
    org, admin_user, occurrence_ids[1], 1, 'series',
    pg_temp.daily_series(job, first_day, '13:00', 1, 5),
    (select jsonb_agg(pg_temp.timed_item(job, first_day + day, '13:00', 60)
       || jsonb_build_object('identityOriginalStartLocal', to_char(first_day + day, 'YYYY-MM-DD') || 'T09:00')
       order by day) from generate_series(0, 4) day),
    jsonb_build_array(jsonb_build_object('employeeRecordId', employee_record)),
    '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  if (select start_at from public.planning_occurrences where id = second_id) <> exception_start
     or exists (select 1 from public.planning_occurrences
                where series_lineage_id = lineage and id <> second_id
                  and pg_temp.berlin_time(start_at) <> '13:00')
     or (select array_agg(original_start_local::text order by original_start_local)
         from public.planning_occurrences where series_lineage_id = lineage) is distinct from identities_before
     or not exists (select 1 from public.planning_events
                    where occurrence_id = occurrence_ids[1] and event_type = 'series_changed')
    then raise exception 'a whole-series edit rewrote the exception or lost an identity'; end if;

  -- Skipping needs a reason and keeps the visit as a traceable row.
  select version into next_version from public.planning_occurrences where id = fifth_id;
  begin
    perform public.set_planning_occurrence_status(org, admin_user, fifth_id, next_version, 'skipped', 'kurz');
    refused := false;
  exception when others then refused := sqlerrm = 'planning_reason_required';
  end;
  if not refused then raise exception 'a skip without a sufficient reason was accepted'; end if;
  perform public.set_planning_occurrence_status(
    org, admin_user, fifth_id, next_version, 'skipped', 'Wird betrieblich nicht benötigt.'
  );
  if (select status::text from public.planning_occurrences where id = fifth_id) <> 'skipped'
     or not (select is_exception from public.planning_occurrences where id = fifth_id)
     or not exists (select 1 from public.planning_events where occurrence_id = fifth_id and event_type = 'skipped')
    then raise exception 'a skipped visit vanished or lost its history'; end if;
end;
$$;

-- Past and started visits are never rewritten, by a single edit, a status
-- change or a whole-series edit.
do $$
declare
  org constant uuid := '76000000-0000-4000-8000-000000000010';
  admin_user constant uuid := '76000000-0000-4000-8000-000000000001';
  yesterday constant date := (now() at time zone 'Europe/Berlin')::date - 1;
  occurrence_ids uuid[];
  past_id uuid;
  future_id uuid;
  past_start timestamptz;
  refused boolean;
begin
  occurrence_ids := public.create_planning_entry_materialized(
    org, admin_user, pg_temp.daily_series(null, yesterday, '06:00', 2, 3),
    (select jsonb_agg(pg_temp.timed_item(null, yesterday + day, '06:00', 60) order by day)
       from unnest(array[0, 2, 4]) day),
    '[]'::jsonb, '76000000-0000-4000-8000-000000000031',
    '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  select id, start_at into past_id, past_start from public.planning_occurrences
  where id = any(occurrence_ids) order by original_start_local limit 1;
  select id into future_id from public.planning_occurrences
  where id = any(occurrence_ids) order by original_start_local offset 1 limit 1;

  begin
    perform public.update_planning_occurrence(
      org, admin_user, past_id, 1, pg_temp.timed_item(null, yesterday, '10:00', 60),
      '[]'::jsonb, '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
    );
    refused := false;
  exception when others then refused := sqlerrm = 'started_planning_occurrence_immutable';
  end;
  if not refused then raise exception 'a past visit accepted a single edit'; end if;
  begin
    perform public.set_planning_occurrence_status(
      org, admin_user, past_id, 1, 'cancelled', 'Nachträglich abgesagt.'
    );
    refused := false;
  exception when others then refused := sqlerrm = 'started_planning_occurrence_immutable';
  end;
  if not refused then raise exception 'a past visit accepted a status change'; end if;

  perform public.reschedule_planning_series(
    org, admin_user, future_id, 1, 'series',
    pg_temp.daily_series(null, yesterday, '10:00', 2, 3),
    (select jsonb_agg(pg_temp.timed_item(null, yesterday + day, '10:00', 60)
       || jsonb_build_object('identityOriginalStartLocal', to_char(yesterday + day, 'YYYY-MM-DD') || 'T06:00')
       order by day) from unnest(array[0, 2, 4]) day),
    '[]'::jsonb, '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  if (select start_at from public.planning_occurrences where id = past_id) <> past_start
     or (select status::text from public.planning_occurrences where id = past_id) <> 'scheduled'
     or exists (select 1 from public.planning_occurrences
                where id = any(occurrence_ids) and id <> past_id
                  and pg_temp.berlin_time(start_at) <> '10:00')
    then raise exception 'a whole-series edit rewrote a past visit or skipped a future one'; end if;

  -- Planning never creates actual work time.
  if exists (select 1 from public.time_entries where organization_id = org)
    then raise exception 'planned visits created actual time entries'; end if;
end;
$$;

-- Visibility: managers see the whole plan; a field worker sees exactly the
-- visits assigned to them and no series, assessments or history; another
-- organization sees nothing.
set local role authenticated;
select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000002', true);
do $$
declare
  org constant uuid := '76000000-0000-4000-8000-000000000010';
begin
  if (select count(*) from public.planning_occurrences where organization_id = org) <> 5
     or exists (select 1 from public.planning_occurrences where organization_id = org and job_id is null)
    then raise exception 'a field worker did not see exactly the assigned visits'; end if;
  if (select count(*) from public.planning_series where organization_id = org) <> 0
     or (select count(*) from public.planning_occurrence_assessments where organization_id = org) <> 0
     or (select count(*) from public.planning_events where organization_id = org) <> 0
    then raise exception 'a field worker could read series, assessments or planning history'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000001', true);
do $$
declare
  org constant uuid := '76000000-0000-4000-8000-000000000010';
begin
  if (select count(*) from public.planning_occurrences where organization_id = org) <> 8
     or (select count(*) from public.planning_series where organization_id = org) < 3
     or (select count(*) from public.planning_events where organization_id = org) = 0
    then raise exception 'a manager did not see the whole plan'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000003', true);
do $$
declare
  org constant uuid := '76000000-0000-4000-8000-000000000010';
begin
  if exists (select 1 from public.planning_occurrences where organization_id = org)
     or exists (select 1 from public.planning_series where organization_id = org)
     or exists (select 1 from public.planning_occurrence_assignments where organization_id = org)
     or exists (select 1 from public.planning_occurrence_assessments where organization_id = org)
     or exists (select 1 from public.planning_events where organization_id = org)
    then raise exception 'another organization could read planning rows'; end if;
end;
$$;

rollback;
