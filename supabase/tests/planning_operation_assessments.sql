-- One capacity and qualification assessment per planning operation
-- (migration 20261028170000). Each of the five planning functions stores the
-- operation's snapshots once in planning_operation_assessments, and every
-- occurrence assessment the call writes references that row instead of
-- carrying its own copy. A call that writes no occurrence, such as a repeated
-- creation, stores no assessment. Only the service role reaches the table and
-- its helper.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('7a000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'operation-assessment-admin@example.test', '', now(), '{}',
 '{"first_name":"Anna","last_name":"Planung"}', now(), now()),
('7a000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'operation-assessment-bea@example.test', '', now(), '{}',
 '{"first_name":"Bea","last_name":"Planung"}', now(), now()),
('7a000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'operation-assessment-cem@example.test', '', now(), '{}',
 '{"first_name":"Cem","last_name":"Planung"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('7a000000-0000-4000-8000-000000000010', 'Operation assessments',
 '7a000000-0000-4000-8000-000000000001', 'OPASSESS');
insert into public.organization_members (organization_id, user_id, role) values
('7a000000-0000-4000-8000-000000000010', '7a000000-0000-4000-8000-000000000002', 'employee'),
('7a000000-0000-4000-8000-000000000010', '7a000000-0000-4000-8000-000000000003', 'employee');
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('7a000000-0000-4000-8000-000000000020', '7a000000-0000-4000-8000-000000000010',
 'Wartungsserie', 'OPA-0001', '7a000000-0000-4000-8000-000000000001');

-- The assessments a step has already checked.
create temporary table seen_operations (id uuid primary key) on commit drop;
create temporary table seen_occurrence_assessments (id uuid primary key) on commit drop;
grant select, insert on seen_operations, seen_occurrence_assessments to service_role;

create function pg_temp.day(p_offset integer) returns date language sql as $$
  select (now() at time zone 'Europe/Berlin')::date + p_offset;
$$;
create function pg_temp.timed_item(p_day date, p_time time) returns jsonb language sql as $$
  select jsonb_build_object(
    'jobId', '7a000000-0000-4000-8000-000000000020', 'entryKind', 'job_visit', 'timeKind', 'timed',
    'originalStartLocal', to_char(p_day, 'YYYY-MM-DD') || 'T' || to_char(p_time, 'HH24:MI'),
    'identityOriginalStartLocal', to_char(p_day, 'YYYY-MM-DD') || 'T' || to_char(p_time, 'HH24:MI'),
    'startAt', (p_day + p_time) at time zone 'Europe/Berlin',
    'endAt', (p_day + p_time + interval '1 hour') at time zone 'Europe/Berlin'
  );
$$;
-- Every person of the organization on each item.
create function pg_temp.crew_on(p_items jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrenceOriginalStartLocal', item->>'originalStartLocal', 'employeeRecordId', record.id)), '[]')
  from jsonb_array_elements(p_items) item
  cross join public.employee_records record
  where record.organization_id = '7a000000-0000-4000-8000-000000000010';
$$;
create function pg_temp.version_of(p_occurrence_id uuid) returns integer language sql as $$
  select version from public.planning_occurrences where id = p_occurrence_id;
$$;
create function pg_temp.capacity(p_label text) returns jsonb language sql as $$
  select jsonb_build_object('employeeDays', jsonb_build_array(p_label), 'conflicts', '[]'::jsonb);
$$;
create function pg_temp.qualification(p_label text) returns jsonb language sql as $$
  select jsonb_build_object('evaluations', jsonb_build_array(p_label));
$$;

-- The rule after one call: it stored exactly one operation assessment with
-- its snapshots, and each occurrence assessment it wrote references that row
-- and carries no copy. p_occurrences is the number it wrote.
create function pg_temp.assert_one_operation(p_label text, p_occurrences integer) returns void
language plpgsql as $$
declare
  v_operation_ids uuid[];
  v_new_assessments integer;
begin
  select coalesce(array_agg(operation.id), '{}') into v_operation_ids
  from public.planning_operation_assessments operation
  where operation.organization_id = '7a000000-0000-4000-8000-000000000010'
    and operation.id not in (select id from seen_operations);
  if cardinality(v_operation_ids) <> 1 then
    raise exception '%: stored % operation assessments instead of one', p_label, cardinality(v_operation_ids);
  end if;
  if (select capacity_snapshot from public.planning_operation_assessments where id = v_operation_ids[1])
       <> pg_temp.capacity(p_label)
     or (select qualification_snapshot from public.planning_operation_assessments where id = v_operation_ids[1])
       <> pg_temp.qualification(p_label)
  then raise exception '%: the operation assessment does not hold the call''s snapshots', p_label; end if;

  select count(*) into v_new_assessments
  from public.planning_occurrence_assessments assessment
  where assessment.organization_id = '7a000000-0000-4000-8000-000000000010'
    and assessment.id not in (select id from seen_occurrence_assessments);
  if v_new_assessments <> p_occurrences then
    raise exception '%: wrote % occurrence assessments instead of %', p_label, v_new_assessments, p_occurrences;
  end if;
  if exists (
    select 1 from public.planning_occurrence_assessments assessment
    where assessment.organization_id = '7a000000-0000-4000-8000-000000000010'
      and assessment.id not in (select id from seen_occurrence_assessments)
      and (assessment.operation_assessment_id is distinct from v_operation_ids[1]
           or assessment.capacity_snapshot <> '[]'::jsonb
           or assessment.qualification_snapshot <> '[]'::jsonb)
  ) then
    raise exception '%: an occurrence assessment does not reference the operation or carries its own copy', p_label;
  end if;

  insert into seen_operations select unnest(v_operation_ids);
  insert into seen_occurrence_assessments
  select id from public.planning_occurrence_assessments
  where organization_id = '7a000000-0000-4000-8000-000000000010'
  on conflict do nothing;
end;
$$;
-- New functions are closed by default (migration 20261015100100).
grant execute on all functions in schema pg_temp to service_role;

set local role service_role;

do $$
declare
  org constant uuid := '7a000000-0000-4000-8000-000000000010';
  admin_user constant uuid := '7a000000-0000-4000-8000-000000000001';
  creation_key constant uuid := '7a000000-0000-4000-8000-000000000030';
  v_series jsonb;
  v_items jsonb;
  v_ids uuid[];
  v_series_id uuid;
  v_new jsonb;
begin
  -- 1. A daily series of five visits for three people: one assessment for all five.
  v_series := jsonb_build_object(
    'jobId', '7a000000-0000-4000-8000-000000000020', 'entryKind', 'job_visit', 'timeKind', 'timed',
    'startsAtLocal', to_char(pg_temp.day(20), 'YYYY-MM-DD') || 'T07:00',
    'segmentStartLocal', to_char(pg_temp.day(20), 'YYYY-MM-DD') || 'T07:00',
    'durationMinutes', 60, 'frequency', 'daily', 'interval', 1, 'occurrenceCount', 7,
    'generatedThroughLocal', to_char(pg_temp.day(24), 'YYYY-MM-DD') || 'T07:00');
  select jsonb_agg(pg_temp.timed_item(pg_temp.day(day), '07:00') order by day)
  into v_items from generate_series(20, 24) day;
  v_ids := public.create_planning_entry_materialized(
    org, admin_user, v_series, v_items, pg_temp.crew_on(v_items), creation_key,
    pg_temp.capacity('create'), 'capacity create', pg_temp.qualification('create'), 'qualification create');
  perform pg_temp.assert_one_operation('create', 5);

  -- 2. The same creation again returns the series and stores nothing.
  perform public.create_planning_entry_materialized(
    org, admin_user, v_series, v_items, pg_temp.crew_on(v_items), creation_key,
    pg_temp.capacity('repeat'), 'capacity repeat', pg_temp.qualification('repeat'), 'qualification repeat');
  if exists (select 1 from public.planning_operation_assessments
             where organization_id = org and id not in (select id from seen_operations))
  then raise exception 'a repeated creation stored an operation assessment'; end if;

  -- 3. Extending the series by two visits: one assessment for both.
  select series_id into v_series_id from public.planning_occurrences where id = v_ids[1];
  select jsonb_agg(pg_temp.timed_item(pg_temp.day(day), '07:00') order by day)
  into v_new from generate_series(25, 26) day;
  perform public.extend_planning_series_materialization(
    org, admin_user, v_series_id, (pg_temp.day(24) + time '07:00')::timestamp, v_new,
    pg_temp.crew_on(v_new),
    pg_temp.capacity('extend'), 'capacity extend', pg_temp.qualification('extend'), 'qualification extend');
  perform pg_temp.assert_one_operation('extend', 2);

  -- 4. One visit moved on its own.
  perform public.update_planning_occurrence(
    org, admin_user, v_ids[2], pg_temp.version_of(v_ids[2]), pg_temp.timed_item(pg_temp.day(21), '09:00'),
    jsonb_build_array(jsonb_build_object('employeeRecordId',
      (select id from public.employee_records where organization_id = org
       and user_id = '7a000000-0000-4000-8000-000000000002'))),
    pg_temp.capacity('update'), 'capacity update', pg_temp.qualification('update'), 'qualification update');
  perform pg_temp.assert_one_operation('update', 1);

  -- 5. Two visits moved in one batch: one assessment for both.
  perform public.batch_reschedule_planning_occurrences(
    org, admin_user, gen_random_uuid(), 'Lieferung verspätet sich',
    (select jsonb_agg(jsonb_build_object(
       'occurrenceId', occurrence.id, 'expectedVersion', occurrence.version,
       'startAt', occurrence.start_at + interval '2 hours', 'endAt', occurrence.end_at + interval '2 hours'))
     from public.planning_occurrences occurrence where occurrence.id in (v_ids[3], v_ids[4])),
    pg_temp.capacity('batch'), 'capacity batch', pg_temp.qualification('batch'), 'qualification batch');
  perform pg_temp.assert_one_operation('batch', 2);

  -- 6. The whole series moved to eleven: one assessment for the four visits it
  -- rewrites; the three visits moved on their own stay exceptions.
  perform public.reschedule_planning_series(
    org, admin_user, v_ids[1], pg_temp.version_of(v_ids[1]), 'series',
    v_series || jsonb_build_object('startsAtLocal', to_char(pg_temp.day(20), 'YYYY-MM-DD') || 'T11:00',
      'generatedThroughLocal', to_char(pg_temp.day(26), 'YYYY-MM-DD') || 'T11:00'),
    (select jsonb_agg(pg_temp.timed_item(pg_temp.day(day), '11:00')
       || jsonb_build_object('identityOriginalStartLocal', to_char(pg_temp.day(day), 'YYYY-MM-DD') || 'T07:00')
       order by day) from generate_series(20, 26) day),
    jsonb_build_array(jsonb_build_object('employeeRecordId',
      (select id from public.employee_records where organization_id = org
       and user_id = '7a000000-0000-4000-8000-000000000003'))),
    pg_temp.capacity('reschedule'), 'capacity reschedule',
    pg_temp.qualification('reschedule'), 'qualification reschedule');
  perform pg_temp.assert_one_operation('reschedule', 4);
end;
$$;

reset role;

-- An operation assessment is append-only history, also for a privileged role,
-- and an occurrence assessment references one of its own organization only.
do $$
declare
  v_operation uuid := (select id from seen_operations limit 1);
  v_refused boolean;
begin
  begin
    update public.planning_operation_assessments set capacity_snapshot = '{}' where id = v_operation;
    v_refused := false;
  exception when raise_exception then v_refused := true;
  end;
  if not v_refused then raise exception 'an operation assessment was rewritten'; end if;
  begin
    delete from public.planning_operation_assessments where id = v_operation;
    v_refused := false;
  exception when raise_exception then v_refused := true;
  end;
  if not v_refused then raise exception 'an operation assessment was deleted'; end if;

  insert into public.organizations (id, name, admin_id, unique_code) values
  ('7a000000-0000-4000-8000-000000000011', 'Other operation assessments',
   '7a000000-0000-4000-8000-000000000001', 'OPASSES2');
  begin
    insert into public.planning_occurrence_assessments (
      organization_id, occurrence_id, operation_assessment_id, capacity_fingerprint, qualification_fingerprint
    ) values (
      '7a000000-0000-4000-8000-000000000010',
      (select occurrence_id from public.planning_occurrence_assessments
       where organization_id = '7a000000-0000-4000-8000-000000000010' limit 1),
      app_private.record_planning_operation_assessment(
        '7a000000-0000-4000-8000-000000000011', null, '{}', '{}'),
      'capacity', 'qualification');
    v_refused := false;
  exception when raise_exception then v_refused := true;
  end;
  if not v_refused then
    raise exception 'an occurrence assessment referenced another organization''s operation assessment';
  end if;
end;
$$;

-- Server-only: no client role reads the table or runs its helper.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.planning_operation_assessments', 'select')
       or has_function_privilege(v_role,
         'app_private.record_planning_operation_assessment(uuid, uuid, jsonb, jsonb)', 'execute')
    then raise exception '% reaches the operation assessments', v_role; end if;
  end loop;
  if exists (
    select 1 from pg_proc proc, aclexplode(proc.proacl) acl
    where proc.oid = 'app_private.record_planning_operation_assessment(uuid, uuid, jsonb, jsonb)'::regprocedure
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then raise exception 'the operation assessment helper is executable by public'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.planning_operation_assessments'::regclass)
  then raise exception 'planning_operation_assessments has no row-level security'; end if;
end;
$$;

rollback;
