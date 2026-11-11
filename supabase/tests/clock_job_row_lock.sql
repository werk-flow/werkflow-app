-- werk-flow/werkflow-planning#348: a clock transition onto a job holds the job
-- row locked until it commits, so a park cannot commit between the validator's
-- status check and the segment insert. It locks the organization's timeline
-- revision row before the job row, the order of every other time write. A
-- second session cannot see this file's uncommitted job, so pgrowlocks reads
-- the row locks from the same transaction. All data and the pgrowlocks
-- installation roll back on exit; only the local stack's superuser may install
-- it.
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
-- transition_work_execution, whose own FOR UPDATE would hide a missing lock.
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
