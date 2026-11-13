\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists pgrowlocks with schema extensions;
set local role postgres;

-- werk-flow/werkflow-planning#447: an approved addition and a clocked session
-- over the same hours never both count.
-- 1. A person forgets to clock out and files an addition for the same hours.
--    The server action refuses it while the session is open
--    (validateCorrectionTimeline, at the proposal and again at the approval).
--    The database half: when the session ends after the office's check, the
--    approval that check allowed is refused.
-- 2. The office approves an addition first, and a phone then sends a clock-in
--    it captured without signal inside those hours. The late event is refused
--    as out of order; one captured after the addition still records.
-- 3. An approval holds its organization's timeline revision row until it
--    commits, so a late event locks that row of each of the person's
--    organizations before it reads their corrections. A second session cannot
--    see this file's uncommitted rows, so pgrowlocks reads the row locks from
--    the same transaction. All data and the pgrowlocks installation roll back
--    on exit; only the local stack's superuser may install it.

create function pg_temp.timeline_fence() returns jsonb language sql as $$
  select jsonb_build_object('timelineRevision', coalesce((select revision from public.time_timeline_revisions
    where organization_id = '44700000-0000-0000-0000-000000000010'), 0));
$$;
-- New functions are closed by default (migration 20261015100100).
grant execute on all functions in schema pg_temp to service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '44700000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'open-session-addition-admin@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Admin","last_name":"Nachtrag"}'::jsonb, now(), now()
),
(
  '44700000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'open-session-addition-employee@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Employee","last_name":"Nachtrag"}'::jsonb, now(), now()
),
(
  '44700000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'late-offline-event-employee@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Offline","last_name":"Nachtrag"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, admin_id, unique_code)
values (
  '44700000-0000-0000-0000-000000000010', 'Open session addition SQL',
  '44700000-0000-0000-0000-000000000001', 'OSA447SQL'
);
-- A second organization of the person in part 2, without any time of its own.
insert into public.organizations (id, name, admin_id, unique_code)
values (
  '44700000-0000-0000-0000-000000000011', 'Open session addition second SQL',
  '44700000-0000-0000-0000-000000000001', 'OSA447SQL2'
);
insert into public.organization_members (organization_id, user_id, role)
values
(
  '44700000-0000-0000-0000-000000000011',
  '44700000-0000-0000-0000-000000000003', 'employee'
),
(
  '44700000-0000-0000-0000-000000000010',
  '44700000-0000-0000-0000-000000000002', 'employee'
),
(
  '44700000-0000-0000-0000-000000000010',
  '44700000-0000-0000-0000-000000000003', 'employee'
);

set local role service_role;

do $$
declare
  c_org constant uuid := '44700000-0000-0000-0000-000000000010';
  c_admin constant uuid := '44700000-0000-0000-0000-000000000001';
  c_employee constant uuid := '44700000-0000-0000-0000-000000000002';
  v_employee_record uuid;
  v_started_at timestamptz := date_trunc('minute', now() - interval '23 hours');
  v_result jsonb;
  v_session uuid;
  v_version bigint;
  v_request uuid;
  v_fence jsonb;
begin
  select id into v_employee_record from public.employee_records
  where organization_id = c_org and user_id = c_employee;

  -- The clock-in the person forgot to end.
  v_result := public.transition_time_activity(
    p_organization_id => c_org, p_actor_id => c_employee,
    p_operation_id => '44700000-0000-0000-0000-000000000020',
    p_request_hash => repeat('a', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated',
    p_captured_at => v_started_at, p_sent_at => now()
  );
  if v_result->>'outcome' is distinct from 'active'
  then raise exception 'the forgotten clock-in did not open a session'; end if;
  v_session := (v_result->>'sessionId')::uuid;
  v_version := (v_result->>'version')::bigint;

  -- The addition for the same hours, filed while the session is still open.
  v_result := public.create_time_correction_request(
    p_organization_id => c_org,
    p_subject_employee_record_id => v_employee_record,
    p_actor_id => c_employee,
    p_operation_id => '44700000-0000-0000-0000-000000000030',
    p_kind => 'add', p_reason => 'Ausstempeln vergessen',
    p_source_scope_key => repeat('c', 64),
    p_source_fingerprint => repeat('d', 64),
    p_before_snapshot => '{"schemaVersion":1,"facts":[]}'::jsonb,
    p_proposed_snapshot => jsonb_build_object('schemaVersion', 1, 'facts', jsonb_build_array(
      jsonb_build_object('factId', 'start', 'employeeRecordId', v_employee_record,
        'userId', c_employee, 'entryType', 'clock_in', 'timestamp', v_started_at,
        'jobId', null, 'activityKind', 'work', 'isManual', true),
      jsonb_build_object('factId', 'end', 'employeeRecordId', v_employee_record,
        'userId', c_employee, 'entryType', 'clock_out',
        'timestamp', v_started_at + interval '9 hours',
        'jobId', null, 'activityKind', 'work', 'isManual', true)
    )),
    p_sources => '[]'::jsonb,
    p_responsibility_snapshot => pg_temp.timeline_fence()
  );
  v_request := (v_result->>'requestId')::uuid;
  if v_result->>'status' is distinct from 'submitted'
  then raise exception 'the addition over the open session was not filed for approval'; end if;

  -- The office's check holds this revision. The forgotten session then ends.
  v_fence := pg_temp.timeline_fence();
  v_result := public.transition_time_activity(
    p_organization_id => c_org, p_actor_id => c_employee,
    p_operation_id => '44700000-0000-0000-0000-000000000021',
    p_request_hash => repeat('b', 64), p_action => 'end',
    p_expected_session_id => v_session, p_expected_version => v_version
  );
  if v_result->>'outcome' is distinct from 'ended'
  then raise exception 'the forgotten session did not end'; end if;

  begin
    perform public.decide_time_correction(
      v_request, c_admin, '44700000-0000-0000-0000-000000000040', 1, 'approve', null, v_fence
    );
    raise exception 'an addition checked before its overlapping session ended was approved';
  exception when others then
    if sqlerrm is distinct from 'time_correction_timeline_changed' then raise; end if;
  end;

  if exists (
    select 1 from public.time_correction_applications
    where organization_id = c_org and request_id = v_request
  ) then raise exception 'the refused approval left the addition counted beside the session'; end if;
  if (
    select status from public.time_correction_requests
    where organization_id = c_org and id = v_request
  ) is distinct from 'submitted'
  then raise exception 'the refused approval did not leave the addition open for a new check'; end if;
  if (
    select count(*) from public.time_sessions
    where organization_id = c_org and user_id = c_employee and ended_at is not null
  ) <> 1
  then raise exception 'the forgotten session is not recorded once as ended'; end if;
end;
$$;

do $$
declare
  c_org constant uuid := '44700000-0000-0000-0000-000000000010';
  c_admin constant uuid := '44700000-0000-0000-0000-000000000001';
  c_employee constant uuid := '44700000-0000-0000-0000-000000000003';
  v_employee_record uuid;
  v_added_from timestamptz := date_trunc('minute', now() - interval '23 hours');
  v_result jsonb;
begin
  select id into v_employee_record from public.employee_records
  where organization_id = c_org and user_id = c_employee;

  v_result := public.create_time_correction_request(
    p_organization_id => c_org,
    p_subject_employee_record_id => v_employee_record,
    p_actor_id => c_employee,
    p_operation_id => '44700000-0000-0000-0000-000000000031',
    p_kind => 'add', p_reason => 'Handy hatte kein Netz',
    p_source_scope_key => repeat('e', 64),
    p_source_fingerprint => repeat('f', 64),
    p_before_snapshot => '{"schemaVersion":1,"facts":[]}'::jsonb,
    p_proposed_snapshot => jsonb_build_object('schemaVersion', 1, 'facts', jsonb_build_array(
      jsonb_build_object('factId', 'start', 'employeeRecordId', v_employee_record,
        'userId', c_employee, 'entryType', 'clock_in', 'timestamp', v_added_from,
        'jobId', null, 'activityKind', 'work', 'isManual', true),
      jsonb_build_object('factId', 'end', 'employeeRecordId', v_employee_record,
        'userId', c_employee, 'entryType', 'clock_out',
        'timestamp', v_added_from + interval '9 hours',
        'jobId', null, 'activityKind', 'work', 'isManual', true)
    )),
    p_sources => '[]'::jsonb,
    p_responsibility_snapshot => pg_temp.timeline_fence()
  );
  v_result := public.decide_time_correction(
    (v_result->>'requestId')::uuid, c_admin, '44700000-0000-0000-0000-000000000041',
    1, 'approve', null, pg_temp.timeline_fence()
  );
  if v_result->>'status' is distinct from 'approved'
  then raise exception 'the office could not approve the addition'; end if;

  begin
    perform public.transition_time_activity(
      p_organization_id => c_org, p_actor_id => c_employee,
      p_operation_id => '44700000-0000-0000-0000-000000000022',
      p_request_hash => repeat('a', 64), p_action => 'start',
      p_segment_kind => 'work', p_allocation_kind => 'unallocated',
      p_captured_at => v_added_from + interval '1 hour', p_sent_at => now()
    );
    raise exception 'a late offline clock-in inside an approved addition was recorded';
  exception when others then
    if sqlerrm is distinct from 'time_transition_captured_out_of_order' then raise; end if;
  end;
  if exists (
    select 1 from public.time_sessions
    where organization_id = c_org and user_id = c_employee
  ) then raise exception 'the refused late clock-in left a session beside the addition'; end if;

  v_result := public.transition_time_activity(
    p_organization_id => c_org, p_actor_id => c_employee,
    p_operation_id => '44700000-0000-0000-0000-000000000023',
    p_request_hash => repeat('b', 64), p_action => 'start',
    p_segment_kind => 'work', p_allocation_kind => 'unallocated',
    p_captured_at => v_added_from + interval '10 hours', p_sent_at => now()
  );
  if v_result->>'outcome' is distinct from 'active'
  then raise exception 'a late offline clock-in after the approved addition was refused'; end if;
end;
$$;

reset role;
do $$
declare
  v_source text := (
    select prosrc from pg_proc
    where oid = 'app_private.transition_time_activity'::regproc
  );
begin
  -- Part 2's recorded late clock-in ran in the first organization only, so
  -- only the read's own lock holds the second organization's row.
  if not exists (
    select 1
    from extensions.pgrowlocks('public.time_timeline_revisions') row_lock
    join public.time_timeline_revisions revision on revision.ctid = row_lock.locked_row
    where revision.organization_id = '44700000-0000-0000-0000-000000000011'
      and 'For Update' = any(row_lock.modes)
  ) then raise exception 'a late event read corrections without locking the timeline revision of each of the person''s organizations'; end if;
  -- position() is 0 for absent text, so each marker must be found before the
  -- comparison can mean anything.
  if position('from public.time_timeline_revisions revision' in v_source) = 0
  then raise exception 'the transition no longer locks with "from public.time_timeline_revisions revision"; update this lock-order check'; end if;
  if position('from public.time_correction_applications application' in v_source) = 0
  then raise exception 'the transition no longer reads "from public.time_correction_applications application"; update this lock-order check'; end if;
  if position('from public.time_timeline_revisions revision' in v_source)
    > position('from public.time_correction_applications application' in v_source)
  then raise exception 'a late event reads corrections before it locks the timeline revisions, so an approval in flight slips past'; end if;
end;
$$;

rollback;
