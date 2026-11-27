-- werk-flow/werkflow-planning#348: a clock transition onto a job holds the job
-- row locked until it commits, so a park cannot commit between the validator's
-- status check and the segment insert. It locks the organization's timeline
-- revision row before the job row, the order of every other time write. A
-- second session cannot see this file's uncommitted job, so pgrowlocks reads
-- the row locks from the same transaction. All data and the pgrowlocks
-- installation roll back on exit; only the local stack's superuser may install
-- it. The second part below runs two sessions on committed rows.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists pgrowlocks with schema extensions;
set local role postgres;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '34800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'clock-lock-admin@example.test', '', now(),
  '{}', '{"first_name":"Clock","last_name":"Admin"}', now(), now()
),
(
  '34800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'clock-lock-worker@example.test', '', now(),
  '{}', '{"first_name":"Clock","last_name":"Worker"}', now(), now()
);
insert into public.organizations (id, name, admin_id, unique_code)
values (
  '34800000-0000-4000-8000-000000000010', 'Clock Lock SQL',
  '34800000-0000-4000-8000-000000000001', 'CLKLOCK'
);
insert into public.organization_members (organization_id, user_id, role)
values ('34800000-0000-4000-8000-000000000010', '34800000-0000-4000-8000-000000000002', 'employee');
-- The job's execution has started, so the transition never reaches
-- transition_work_execution, whose own job lock would hide a missing one.
insert into public.jobs (
  id, organization_id, title, job_number, status, execution_state, created_by
) values (
  '34800000-0000-4000-8000-000000000020', '34800000-0000-4000-8000-000000000010',
  'Clock Lock', 'CLKLOCK-1', 'in_bearbeitung', 'in_progress',
  '34800000-0000-4000-8000-000000000001'
);
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by)
values (
  '34800000-0000-4000-8000-000000000010', '34800000-0000-4000-8000-000000000020',
  '34800000-0000-4000-8000-000000000002', '34800000-0000-4000-8000-000000000001'
);

reset role;
-- The validator alone, before the organization has a time write: a time write
-- locks the timeline revision row itself and would hide a missing lock. Its
-- locks roll back with the block, so the switch below proves its own job lock.
do $$
declare
  v_source text := (
    select prosrc from pg_proc
    where oid = 'app_private.validate_time_segment_input'::regproc
  );
begin
  perform app_private.validate_time_segment_input(
    '34800000-0000-4000-8000-000000000010', '34800000-0000-4000-8000-000000000002',
    'employee', 'work', 'job', '34800000-0000-4000-8000-000000000020',
    null, null, null, null
  );
  if not exists (
    select 1
    from extensions.pgrowlocks('public.time_timeline_revisions') row_lock
    join public.time_timeline_revisions revision on revision.ctid = row_lock.locked_row
    where revision.organization_id = '34800000-0000-4000-8000-000000000010'
      and 'For Update' = any(row_lock.modes)
  ) then raise exception 'the clock validator left the timeline revision row unlocked for a time write that then locks the job'; end if;
  -- position() is 0 for absent text, so each marker must be found before the
  -- comparison can mean anything.
  if position('from public.time_timeline_revisions' in v_source) = 0
  then raise exception 'the clock validator no longer reads the timeline revision with "from public.time_timeline_revisions"; update this lock-order check'; end if;
  if position('from public.jobs' in v_source) = 0
  then raise exception 'the clock validator no longer reads the job with "from public.jobs"; update this lock-order check'; end if;
  if position('from public.time_timeline_revisions' in v_source)
    > position('from public.jobs' in v_source)
  then raise exception 'the clock validator locks the job before the timeline revision, the reverse of a time write'; end if;
  raise exception sqlstate 'WF348';
exception when sqlstate 'WF348' then null;
end;
$$;

set local role service_role;
do $$
declare
  v_result jsonb;
begin
  v_result := public.transition_time_activity(
    p_organization_id => '34800000-0000-4000-8000-000000000010',
    p_actor_id => '34800000-0000-4000-8000-000000000002',
    p_operation_id => '34800000-0000-4000-8000-000000000031',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated'
  );
  v_result := public.transition_time_activity(
    p_organization_id => '34800000-0000-4000-8000-000000000010',
    p_actor_id => '34800000-0000-4000-8000-000000000002',
    p_operation_id => '34800000-0000-4000-8000-000000000032',
    p_request_hash => repeat('b', 64), p_action => 'switch',
    p_expected_session_id => (v_result->>'sessionId')::uuid,
    p_expected_version => (v_result->>'version')::bigint,
    p_segment_kind => 'work', p_allocation_kind => 'job',
    p_job_id => '34800000-0000-4000-8000-000000000020'
  );
  if v_result->>'outcome' is distinct from 'active'
  then raise exception 'switch onto the job did not start its segment: %', v_result; end if;
end;
$$;

reset role;
do $$
begin
  if not exists (
    select 1
    from extensions.pgrowlocks('public.jobs') row_lock
    join public.jobs job on job.ctid = row_lock.locked_row
    where job.id = '34800000-0000-4000-8000-000000000020'
      and 'For No Key Update' = any(row_lock.modes)
  ) then raise exception 'a switch onto a job left its row unlocked for a concurrent park'; end if;
end;
$$;

rollback;

-- werk-flow/werkflow-planning#361: a time write that holds the revision row
-- can lock a job that a second time entry references. A time entry takes a
-- key-share lock on its job (the foreign key check) and then waits for the
-- revision row. Before migration
-- 20270503090000_let_a_time_entry_reference_a_job_while_its_work_starts.sql a
-- clock-in on the job (transition_work_on_time_start) and the clock starting
-- work on a job (transition_work_execution_p1_15) locked it FOR UPDATE, which
-- waits for that key share: `deadlock detected`. FOR NO KEY UPDATE does not.
--
-- Two sessions force the overlap. The first holds the revision row through a
-- time write without a job; the second writes an entry onto the job and waits
-- for the revision row. The first then locks the job, which must go through,
-- and the second must go through once the first rolls back. Cases: a manual
-- clock-in and an entry edit against a clock-in on a running job, and a manual
-- clock-in against the clock switching onto a job that has not started.
--
-- The sessions need committed rows, so this part writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. Its one committed time entry, the one the
-- edit moves, is deleted before the organization, which refuses deletion
-- while it holds time. Both sessions roll back every time write. The main
-- session only orchestrates and rolls back.
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('entry_lock_setup', 'dbname=postgres user=postgres');
select dblink_connect('entry_lock_first', 'dbname=postgres user=postgres');
select dblink_connect('entry_lock_second', 'dbname=postgres user=postgres');

create temporary table entry_lock_cleanup (statement text) on commit drop;
insert into entry_lock_cleanup values
  ('delete from public.time_entries where organization_id = ''36100000-0000-4000-8000-000000000010'''),
  ('delete from public.organizations where id = ''36100000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id in (''36100000-0000-4000-8000-000000000001'', '
    '''36100000-0000-4000-8000-000000000002'', ''36100000-0000-4000-8000-000000000003'')');
select dblink_exec('entry_lock_setup', statement) from entry_lock_cleanup;

select dblink_exec('entry_lock_setup', $setup$
begin;
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('36100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'entry-lock-admin@example.test', '', now(), '{}'::jsonb,
 '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
('36100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'entry-lock-first@example.test', '', now(), '{}'::jsonb,
 '{"first_name":"Jonas","last_name":"Becker"}'::jsonb, now(), now()),
('36100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'entry-lock-second@example.test', '', now(), '{}'::jsonb,
 '{"first_name":"Lea","last_name":"Wagner"}'::jsonb, now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('36100000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Sperrfolge',
 '36100000-0000-4000-8000-000000000001', 'ENTRYLK');
insert into public.organization_members (organization_id, user_id, role) values
('36100000-0000-4000-8000-000000000010', '36100000-0000-4000-8000-000000000002', 'employee'),
('36100000-0000-4000-8000-000000000010', '36100000-0000-4000-8000-000000000003', 'employee');
-- A running job, and one whose work has not started.
insert into public.jobs (id, organization_id, title, job_number, status, execution_state, created_by) values
('36100000-0000-4000-8000-000000000020', '36100000-0000-4000-8000-000000000010',
 'Heizungswartung Lindenhof', 'ENTRYLK-1', 'in_bearbeitung', 'in_progress',
 '36100000-0000-4000-8000-000000000001'),
('36100000-0000-4000-8000-000000000021', '36100000-0000-4000-8000-000000000010',
 'Badsanierung Kastanienweg', 'ENTRYLK-2', 'nicht_bearbeitet', 'not_started',
 '36100000-0000-4000-8000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by)
select '36100000-0000-4000-8000-000000000010', job, worker, '36100000-0000-4000-8000-000000000001'
from unnest(array['36100000-0000-4000-8000-000000000020',
  '36100000-0000-4000-8000-000000000021']::uuid[]) job,
  unnest(array['36100000-0000-4000-8000-000000000002',
  '36100000-0000-4000-8000-000000000003']::uuid[]) worker;
-- The entry the edit case moves onto the job.
insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp, is_manual, status)
values ('36100000-0000-4000-8000-000000000030', '36100000-0000-4000-8000-000000000003',
  '36100000-0000-4000-8000-000000000010', 'clock_in', date_trunc('day', now()) - interval '1 day' + interval '6 hours',
  true, 'approved');
commit;
$setup$);

create temporary table entry_lock_second_pid on commit drop as
select pid from dblink('entry_lock_second', 'select pg_backend_pid()') as second(pid integer);

-- A manual time entry of p_user at p_hour yesterday, on p_job or without one.
create function pg_temp.entry_insert(p_user text, p_type text, p_hour integer, p_job text default null)
returns text language sql as $$
  select format($insert$insert into public.time_entries (user_id, organization_id, entry_type, timestamp,
    is_manual, status, job_id) values (%L, '36100000-0000-4000-8000-000000000010', %L,
    date_trunc('day', now()) - interval '1 day' + %L::interval, true, 'approved', %L)$insert$,
    p_user, p_type, p_hour || ' hours', p_job);
$$;

-- The first session runs p_hold (a time write without a job, which holds the
-- revision row), the second p_second (a write onto the job), which must wait
-- for it. The first then runs p_lock_job, which locks the job; both must go
-- through.
create function pg_temp.check_overlap(p_case text, p_hold text, p_second text, p_lock_job text)
returns void language plpgsql as $$
declare
  v_pid integer := (select pid from entry_lock_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
  v_message text;
begin
  perform dblink_exec('entry_lock_first', 'begin');
  perform dblink_exec('entry_lock_first', 'set local role service_role');
  perform * from dblink('entry_lock_first', p_hold) as held(result text);

  perform dblink_exec('entry_lock_second', 'begin');
  perform dblink_exec('entry_lock_second', 'set local role service_role');
  perform dblink_send_query('entry_lock_second', p_second);
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception '%: the second session never waited for the first one''s revision row', p_case;
    end if;
  end loop;

  begin
    perform * from dblink('entry_lock_first', p_lock_job) as locked(result text);
  exception when others then
    raise exception '%: the first session failed to lock the job while the second waited: %',
      p_case, sqlerrm;
  end;
  perform dblink_exec('entry_lock_first', 'rollback');

  perform * from dblink_get_result('entry_lock_second', false) as result(status text);
  v_message := dblink_error_message('entry_lock_second');
  perform * from dblink_get_result('entry_lock_second', false) as done(status text);
  if v_message is distinct from 'OK' then
    raise exception '%: the second session failed once the first rolled back: %', p_case, v_message;
  end if;
  perform dblink_exec('entry_lock_second', 'rollback');
end;
$$;

select pg_temp.check_overlap('a manual clock-in against a clock-in on a running job',
  pg_temp.entry_insert('36100000-0000-4000-8000-000000000002', 'clock_in', 6),
  pg_temp.entry_insert('36100000-0000-4000-8000-000000000003', 'clock_in', 8,
    '36100000-0000-4000-8000-000000000020'),
  pg_temp.entry_insert('36100000-0000-4000-8000-000000000002', 'break_end', 7,
    '36100000-0000-4000-8000-000000000020'));

select pg_temp.check_overlap('an entry edit onto a running job against a clock-in on it',
  pg_temp.entry_insert('36100000-0000-4000-8000-000000000002', 'clock_in', 6),
  $edit$
    select public.update_time_entry('36100000-0000-4000-8000-000000000001',
      '36100000-0000-4000-8000-000000000010', '36100000-0000-4000-8000-000000000030',
      '{"job_id":"36100000-0000-4000-8000-000000000020"}'::jsonb)
  $edit$,
  pg_temp.entry_insert('36100000-0000-4000-8000-000000000002', 'break_end', 7,
    '36100000-0000-4000-8000-000000000020'));

select pg_temp.check_overlap('a manual clock-in against the clock starting work on the job',
  $start$
    select public.transition_time_activity(
      p_organization_id => '36100000-0000-4000-8000-000000000010',
      p_actor_id => '36100000-0000-4000-8000-000000000002',
      p_operation_id => '36100000-0000-4000-8000-000000000041',
      p_request_hash => repeat('a', 64), p_action => 'start',
      p_segment_kind => 'work', p_allocation_kind => 'unallocated')
  $start$,
  pg_temp.entry_insert('36100000-0000-4000-8000-000000000003', 'clock_in', 8,
    '36100000-0000-4000-8000-000000000021'),
  $switch$
    select public.transition_time_activity(
      p_organization_id => '36100000-0000-4000-8000-000000000010',
      p_actor_id => '36100000-0000-4000-8000-000000000002',
      p_operation_id => '36100000-0000-4000-8000-000000000042',
      p_request_hash => repeat('b', 64), p_action => 'switch',
      p_expected_session_id => session.id, p_expected_version => session.version,
      p_segment_kind => 'work', p_allocation_kind => 'job',
      p_job_id => '36100000-0000-4000-8000-000000000021')
    from public.time_sessions session
    where session.user_id = '36100000-0000-4000-8000-000000000002' and session.ended_at is null
  $switch$);

select dblink_exec('entry_lock_setup', statement) from entry_lock_cleanup;

select dblink_disconnect('entry_lock_second');
select dblink_disconnect('entry_lock_first');
select dblink_disconnect('entry_lock_setup');
rollback;
