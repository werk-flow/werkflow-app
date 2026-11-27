-- An approval that moves time to a person signals them without waiting for
-- their personnel record (20270701090001_index_correction_reads_by_person_and_window.sql,
-- werk-flow/werkflow-planning#610). The approval holds the organization's
-- timeline revision when it signals; a clock transition locks the person's
-- record before it writes time, which takes that revision. Waiting for the
-- record there would deadlock the two.
--
-- The first session holds the recipient's record as a clock transition does;
-- the second approves the reassignment under a lock timeout and must finish.
-- The sessions need committed rows, so this file writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. The main session only orchestrates and rolls back.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('signal_order_setup', 'dbname=postgres user=postgres');
select dblink_connect('signal_order_clock', 'dbname=postgres user=postgres');
select dblink_connect('signal_order_approval', 'dbname=postgres user=postgres');

-- Correction history is immutable and its requests keep their subject's record,
-- so the cleanup removes it before the organization.
create temporary table signal_order_cleanup (position integer, statement text) on commit drop;
insert into signal_order_cleanup values
  (1, 'delete from public.time_correction_request_sources where organization_id = ''61000000-0000-4000-8000-000000000010'''),
  (2, 'delete from public.time_correction_applications where organization_id = ''61000000-0000-4000-8000-000000000010'''),
  (3, 'delete from public.time_correction_events where organization_id = ''61000000-0000-4000-8000-000000000010'''),
  (4, 'delete from public.time_correction_request_revisions where organization_id = ''61000000-0000-4000-8000-000000000010'''),
  (5, 'delete from public.time_correction_requests where organization_id = ''61000000-0000-4000-8000-000000000010'''),
  (6, 'delete from public.organizations where id = ''61000000-0000-4000-8000-000000000010'''),
  (7, 'delete from auth.users where id in (''61000000-0000-4000-8000-000000000001'', ''61000000-0000-4000-8000-000000000002'', ''61000000-0000-4000-8000-000000000003'')');
select dblink_exec('signal_order_setup', statement) from signal_order_cleanup order by position;

select dblink_exec('signal_order_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  ('61000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'signal-order-admin@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
  ('61000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'signal-order-subject@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Max","last_name":"Mustermann"}'::jsonb, now(), now()),
  ('61000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'signal-order-recipient@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Moritz","last_name":"Mustermann"}'::jsonb, now(), now());
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('61000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Signalfolge',
   '61000000-0000-4000-8000-000000000001', 'SIGORDER');
  insert into public.organization_members (organization_id, user_id, role) values
  ('61000000-0000-4000-8000-000000000010', '61000000-0000-4000-8000-000000000002', 'employee'),
  ('61000000-0000-4000-8000-000000000010', '61000000-0000-4000-8000-000000000003', 'employee')
  on conflict do nothing;
end $$
$setup$);

-- The subject's and the recipient's records, and each login's signal as committed.
create temporary table signal_order_people on commit drop as
select * from dblink('signal_order_setup', $read$
  select employee.user_id, employee.id, signal.updated_at
  from public.employee_records employee
  left join public.employment_target_signals signal on signal.employee_record_id = employee.id
  where employee.organization_id = '61000000-0000-4000-8000-000000000010' and employee.user_id is not null
$read$) as person(user_id uuid, record_id uuid, signalled timestamptz);

-- The clock transition's first step: the recipient's record, held.
select dblink_exec('signal_order_clock', 'begin');
select locked from dblink('signal_order_clock', format(
  'select 1 from public.employee_records where id = %L for update',
  (select record_id from signal_order_people where user_id = '61000000-0000-4000-8000-000000000003')))
  as clock(locked integer);

-- The admin's correction of the subject's time, applied at once, moves an hour to the recipient.
select dblink_exec('signal_order_approval', 'set lock_timeout = ''5s''');
do $$
begin
  perform * from dblink('signal_order_approval', format($approve$
    select public.create_time_correction_request(
      %1$L, %2$L, '61000000-0000-4000-8000-000000000001', gen_random_uuid(), 'add', 'Stunde umbuchen',
      repeat('8', 64), repeat('9', 64), '{"schemaVersion":1,"facts":[]}',
      jsonb_build_object('schemaVersion', 1, 'facts', jsonb_build_array(
        jsonb_build_object('factId', 'moved-in', 'employeeRecordId', %3$L::uuid,
          'userId', '61000000-0000-4000-8000-000000000003', 'entryType', 'clock_in',
          'timestamp', '2026-08-12T06:00:00Z', 'jobId', null, 'activityKind', 'work', 'isManual', true),
        jsonb_build_object('factId', 'moved-out', 'employeeRecordId', %3$L::uuid,
          'userId', '61000000-0000-4000-8000-000000000003', 'entryType', 'clock_out',
          'timestamp', '2026-08-12T07:00:00Z', 'jobId', null, 'activityKind', 'work', 'isManual', true))),
      '[]',
      jsonb_build_object('timelineRevision', coalesce((select revision from public.time_timeline_revisions
        where organization_id = %1$L), 0)))
  $approve$,
    '61000000-0000-4000-8000-000000000010',
    (select record_id from signal_order_people where user_id = '61000000-0000-4000-8000-000000000002'),
    (select record_id from signal_order_people where user_id = '61000000-0000-4000-8000-000000000003')))
    as approval(result jsonb);
exception when others then
  raise exception 'the approval waited for the recipient''s personnel record: %', sqlerrm;
end $$;
select dblink_exec('signal_order_clock', 'rollback');

-- The approval signalled the recipient, and nobody else.
do $$
declare
  v_after record;
  v_before record;
begin
  for v_after in
    select * from dblink('signal_order_setup', $read$
      select employee.user_id, signal.updated_at
      from public.employee_records employee
      join public.employment_target_signals signal on signal.employee_record_id = employee.id
      where employee.organization_id = '61000000-0000-4000-8000-000000000010'
    $read$) as person(user_id uuid, signalled timestamptz)
  loop
    select * into v_before from signal_order_people where user_id = v_after.user_id;
    if v_before.signalled is null then
      raise exception 'login % had no signal row before the approval', v_after.user_id;
    end if;
    if (v_after.user_id is not distinct from '61000000-0000-4000-8000-000000000003'::uuid)
      is distinct from (v_after.signalled > v_before.signalled) then
      raise exception 'the approval moved the signal of % from % to %', v_after.user_id, v_before.signalled, v_after.signalled;
    end if;
  end loop;
end $$;

select dblink_exec('signal_order_setup', statement) from signal_order_cleanup order by position;
select dblink_disconnect('signal_order_setup');
select dblink_disconnect('signal_order_clock');
select dblink_disconnect('signal_order_approval');
rollback;
