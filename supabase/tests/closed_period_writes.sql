-- The database refuses every write to a recorded time fact of a closed period
-- (migration 20261002110000_refuse_writes_in_closed_periods.sql) with
-- SQLSTATE WFP01 'period_closed', for the service role and for postgres.
-- The period workflow, writes outside the period, writes after a reopen and
-- an organization deletion still pass.
-- A close is refused while a session of the period is still open
-- (migration 20261002150600_refuse_period_close_with_open_sessions.sql).
-- Batched review and deletion of entries apply completely or not at all
-- (migration 20261003110000_apply_time_entry_batches_atomically.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('26100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'closed-period-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Closed"}', now(), now()),
('26100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'closed-period-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Closed"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('26100000-0000-0000-0000-000000000010', 'Closed period SQL',
  '26100000-0000-0000-0000-000000000001', 'CLOSEDPS'),
('26100000-0000-0000-0000-000000000011', 'Open period SQL',
  '26100000-0000-0000-0000-000000000001', 'OPENPSQL');
insert into public.organization_members (organization_id, user_id, role) values
('26100000-0000-0000-0000-000000000010', '26100000-0000-0000-0000-000000000002', 'employee');

-- Seed June 2026 with one entry pair and one canonical session, then close
-- June through the real prepare and close RPCs.
do $$
declare
  v_org constant uuid := '26100000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26100000-0000-0000-0000-000000000001';
  v_employee_user constant uuid := '26100000-0000-0000-0000-000000000002';
  v_admin_record uuid;
  v_employee_record uuid;
  v_fingerprint text;
  v_calculation uuid;
  v_session uuid := '26100000-0000-0000-0000-000000000040';
  v_previous_capture_write text := coalesce(current_setting('app.time_capture_write', true), '');
  v_session_status text;
begin
  select id into v_admin_record from public.employee_records
    where organization_id = v_org and user_id = v_admin;
  select id into v_employee_record from public.employee_records
    where organization_id = v_org and user_id = v_employee_user;
  if v_admin_record is null or v_employee_record is null then
    raise exception 'employee record prerequisite missing';
  end if;
  update public.employee_records set entry_date = '2026-06-01'
    where id in (v_admin_record, v_employee_record);
  perform public.open_time_account(v_org, v_admin_record, 0, '2026-06-01', 'Test-Eröffnung',
    v_admin, '26100000-0000-0000-0000-000000000020', repeat('a', 64));
  perform public.open_time_account(v_org, v_employee_record, 0, '2026-06-01', 'Test-Eröffnung',
    v_admin, '26100000-0000-0000-0000-000000000021', repeat('b', 64));

  insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp, is_manual, status)
  values
    ('26100000-0000-0000-0000-000000000030', v_employee_user, v_org, 'clock_in', '2026-06-15 08:00+02', true, 'approved'),
    ('26100000-0000-0000-0000-000000000031', v_employee_user, v_org, 'clock_out', '2026-06-15 16:00+02', true, 'approved'),
    ('26100000-0000-0000-0000-000000000032', v_employee_user, v_org, 'clock_in', '2026-07-15 08:00+02', true, 'pending'),
    ('26100000-0000-0000-0000-000000000034', v_employee_user, v_org, 'clock_in', '2026-06-17 08:00+02', true, 'pending');

  perform set_config('app.time_capture_write', 'true', true);
  insert into public.time_sessions (
    id, organization_id, employee_record_id, user_id, status, started_at, ended_at, created_by, ended_by
  ) values (
    v_session, v_org, v_employee_record, v_employee_user, 'closed',
    '2026-06-16 08:00+02', '2026-06-16 12:00+02', v_employee_user, v_employee_user
  );
  insert into public.time_segments (
    id, organization_id, session_id, employee_record_id, kind, allocation_kind,
    started_at, ended_at, start_source, end_source, started_by, ended_by
  ) values (
    '26100000-0000-0000-0000-000000000041', v_org, v_session, v_employee_record, 'work', 'unallocated',
    '2026-06-16 08:00+02', '2026-06-16 12:00+02', 'employee', 'employee', v_employee_user, v_employee_user
  );
  perform set_config('app.time_capture_write', v_previous_capture_write, true);

  v_fingerprint := app_private.compute_p1_23_source_fingerprint(v_org, '2026-06-01', '2026-06-30');
  v_calculation := public.prepare_time_period(
    v_admin, v_org, '2026-06-01', '2026-06-30', v_fingerprint,
    jsonb_build_array(
      jsonb_build_object(
        'id', '26100000-0000-0000-0000-000000000050', 'employee_record_id', v_admin_record,
        'policy_version_id', null, 'previous_balance_minutes', 0, 'target_minutes', 0,
        'source_seconds', 0, 'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
        'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
        'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0, 'authoritative_targets', false),
      jsonb_build_object(
        'id', '26100000-0000-0000-0000-000000000051', 'employee_record_id', v_employee_record,
        'policy_version_id', null, 'previous_balance_minutes', 0, 'target_minutes', 0,
        'source_seconds', 0, 'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
        'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
        'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0, 'authoritative_targets', false)
    ), '[]', '[]', '[]', '26100000-0000-0000-0000-000000000052', repeat('c', 64));

  -- A session that opens after the preparation and before the end of June
  -- blocks the close, also while it waits for recovery, although the
  -- preparation reported no finding. Once it ends, a new preparation closes.
  perform set_config('app.time_capture_write', 'true', true);
  insert into public.time_sessions (
    id, organization_id, employee_record_id, user_id, status, started_at, created_by
  ) values (
    '26100000-0000-0000-0000-000000000043', v_org, v_employee_record, v_employee_user, 'open',
    '2026-06-30 23:00+02', v_employee_user
  );
  perform set_config('app.time_capture_write', v_previous_capture_write, true);
  foreach v_session_status in array array['open', 'recovery_required'] loop
    if v_session_status = 'recovery_required' then
      perform set_config('app.time_capture_write', 'true', true);
      update public.time_sessions set status = 'recovery_required', recovery_reason = 'Test'
        where id = '26100000-0000-0000-0000-000000000043';
      perform set_config('app.time_capture_write', v_previous_capture_write, true);
    end if;
    begin
      perform public.close_time_period(
        v_admin, v_org, (select period_id from public.time_period_calculations where id = v_calculation),
        '26100000-0000-0000-0000-000000000053', repeat('d', 64));
      raise exception 'June closed with a % session', v_session_status;
    exception when others then
      if sqlerrm <> 'period_open_sessions' then raise; end if;
    end;
  end loop;
  perform set_config('app.time_capture_write', 'true', true);
  update public.time_sessions
    set status = 'closed', recovery_reason = null, ended_at = '2026-07-01 06:00+02', ended_by = v_employee_user
    where id = '26100000-0000-0000-0000-000000000043';
  perform set_config('app.time_capture_write', v_previous_capture_write, true);
  v_fingerprint := app_private.compute_p1_23_source_fingerprint(v_org, '2026-06-01', '2026-06-30');
  v_calculation := public.prepare_time_period(
    v_admin, v_org, '2026-06-01', '2026-06-30', v_fingerprint,
    jsonb_build_array(
      jsonb_build_object(
        'id', '26100000-0000-0000-0000-000000000055', 'employee_record_id', v_admin_record,
        'policy_version_id', null, 'previous_balance_minutes', 0, 'target_minutes', 0,
        'source_seconds', 0, 'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
        'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
        'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0, 'authoritative_targets', false),
      jsonb_build_object(
        'id', '26100000-0000-0000-0000-000000000056', 'employee_record_id', v_employee_record,
        'policy_version_id', null, 'previous_balance_minutes', 0, 'target_minutes', 0,
        'source_seconds', 0, 'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
        'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
        'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0, 'authoritative_targets', false)
    ), '[]', '[]', '[]', '26100000-0000-0000-0000-000000000057', repeat('f', 64));

  perform public.close_time_period(
    v_admin, v_org, (select period_id from public.time_period_calculations where id = v_calculation),
    '26100000-0000-0000-0000-000000000053', repeat('d', 64));
  if (select state from public.time_periods where organization_id = v_org) <> 'closed' then
    raise exception 'the period workflow did not close June';
  end if;
end;
$$;

-- Runs one statement and requires the closed-period refusal.
create function pg_temp.expect_period_closed(p_label text, p_statement text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when sqlstate 'WFP01' then
    if sqlerrm <> 'period_closed' then
      raise exception '% raised WFP01 with message %', p_label, sqlerrm;
    end if;
    return;
  end;
  raise exception '% changed a closed period', p_label;
end;
$$;
grant execute on function pg_temp.expect_period_closed(text, text) to service_role;

-- Runs one batch call and requires the named refusal.
create function pg_temp.expect_batch_refusal(p_label text, p_statement text, p_refusal text) returns void
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
grant execute on function pg_temp.expect_batch_refusal(text, text, text) to service_role;

-- The 150 ids of the batch section below, in order.
create view pg_temp.batch_ids as
select array_agg(('26100000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid order by n) ids
from generate_series(1, 150) n;
grant select on pg_temp.batch_ids to service_role;

set local role service_role;

select pg_temp.expect_period_closed('service insert in June', $sql$
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status)
  values ('26100000-0000-0000-0000-000000000002', '26100000-0000-0000-0000-000000000010',
    'clock_in', '2026-06-20 08:00+02', true, 'pending')
$sql$);
select pg_temp.expect_period_closed('service timestamp edit inside June', $sql$
  update public.time_entries set timestamp = '2026-06-15 08:30+02'
  where id = '26100000-0000-0000-0000-000000000030'
$sql$);
select pg_temp.expect_period_closed('service move out of June', $sql$
  update public.time_entries set timestamp = '2026-07-01 08:00+02'
  where id = '26100000-0000-0000-0000-000000000030'
$sql$);
select pg_temp.expect_period_closed('service move into June', $sql$
  update public.time_entries set timestamp = '2026-06-20 08:00+02'
  where id = '26100000-0000-0000-0000-000000000032'
$sql$);
select pg_temp.expect_period_closed('service review of a June entry', $sql$
  update public.time_entries set status = 'approved'
  where id = '26100000-0000-0000-0000-000000000031'
$sql$);
select pg_temp.expect_period_closed('service delete in June', $sql$
  delete from public.time_entries where id = '26100000-0000-0000-0000-000000000031'
$sql$);
-- 00:00 on 1 July closes 30 June; a clock_in at the same instant opens 1 July.
select pg_temp.expect_period_closed('service midnight clock_out', $sql$
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status)
  values ('26100000-0000-0000-0000-000000000002', '26100000-0000-0000-0000-000000000010',
    'clock_out', '2026-07-01 00:00+02', true, 'pending')
$sql$);

do $$
begin
  insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp, is_manual, status)
  values ('26100000-0000-0000-0000-000000000033', '26100000-0000-0000-0000-000000000002',
    '26100000-0000-0000-0000-000000000010', 'clock_in', '2026-07-01 00:00+02', true, 'pending');
  update public.time_entries set status = 'approved', timestamp = '2026-07-15 08:05+02'
    where id = '26100000-0000-0000-0000-000000000032';
  delete from public.time_entries where id = '26100000-0000-0000-0000-000000000033';
  -- A closed June of one organization does not lock another organization.
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status)
  values ('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000011',
    'clock_in', '2026-06-20 08:00+02', true, 'approved');
  if (select count(*) from public.time_entries
      where organization_id = '26100000-0000-0000-0000-000000000010'
        and timestamp < '2026-07-01 00:00+02') <> 3
  then raise exception 'June entries changed'; end if;
end;
$$;

-- Batched review and deletion (migration 20261003110000) apply to every named
-- entry or to none. 150 pending July entries span two id batches of 100, and
-- the refused entry comes last: the pending June entry 034 of the closed
-- period, the approved July entry 032, an entry of another organization.
insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp, is_manual, status)
select ('26100000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid,
  '26100000-0000-0000-0000-000000000002', '26100000-0000-0000-0000-000000000010',
  'clock_in', '2026-07-20 08:00+02'::timestamptz + make_interval(mins => n), true, 'pending'
from generate_series(1, 150) n;
insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp, is_manual, status) values
('26100000-0000-0000-0002-000000000001', '26100000-0000-0000-0000-000000000001',
  '26100000-0000-0000-0000-000000000011', 'clock_in', '2026-07-21 08:00+02', true, 'pending'),
('26100000-0000-0000-0002-000000000002', '26100000-0000-0000-0000-000000000001',
  '26100000-0000-0000-0000-000000000010', 'clock_in', '2026-07-21 08:00+02', true, 'pending');

select pg_temp.expect_batch_refusal('review with a closed-period entry last', $sql$
  select public.review_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids) || '26100000-0000-0000-0000-000000000034'::uuid, 'approved',
    array['26100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'period_closed');
select pg_temp.expect_batch_refusal('review with a reviewed entry last', $sql$
  select public.review_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids) || '26100000-0000-0000-0000-000000000032'::uuid, 'approved',
    array['26100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'entry_not_pending');
select pg_temp.expect_batch_refusal('review with a foreign entry last', $sql$
  select public.review_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids) || '26100000-0000-0000-0002-000000000001'::uuid, 'approved',
    array['26100000-0000-0000-0000-000000000001'::uuid, '26100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'entry_not_found');
select pg_temp.expect_batch_refusal('review of the own entry last', $sql$
  select public.review_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids) || '26100000-0000-0000-0002-000000000002'::uuid, 'approved',
    array['26100000-0000-0000-0000-000000000001'::uuid, '26100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'self_approval_not_allowed');
select pg_temp.expect_batch_refusal('review without responsibility', $sql$
  select public.review_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids), 'rejected', null)
$sql$, 'not_responsible');
select pg_temp.expect_batch_refusal('review by a non-member', $sql$
  select public.review_time_entries('26100000-0000-0000-0000-0000000000ff', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids), 'approved', array['26100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'not_a_member');
select pg_temp.expect_batch_refusal('review with a repeated id', $sql$
  select public.review_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids) || (select ids[1] from pg_temp.batch_ids), 'approved',
    array['26100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'invalid_input');
select pg_temp.expect_batch_refusal('delete with a closed-period entry last', $sql$
  select public.delete_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids) || '26100000-0000-0000-0000-000000000034'::uuid,
    array['26100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'period_closed');
select pg_temp.expect_batch_refusal('delete with a foreign entry last', $sql$
  select public.delete_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids) || '26100000-0000-0000-0002-000000000001'::uuid,
    array['26100000-0000-0000-0000-000000000001'::uuid, '26100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'entry_not_found');
select pg_temp.expect_batch_refusal('delete of a person the actor may not manage', $sql$
  select public.delete_time_entries('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    (select ids from pg_temp.batch_ids), array[]::uuid[])
$sql$, 'not_authorized');

do $$
declare
  v_ids uuid[] := (select ids from pg_temp.batch_ids);
  v_result integer;
begin
  if (select count(*) from public.time_entries where id = any(v_ids) and status = 'pending') <> 150
    or (select status from public.time_entries where id = '26100000-0000-0000-0000-000000000034') <> 'pending'
    or (select status from public.time_entries where id = '26100000-0000-0000-0002-000000000001') <> 'pending'
  then raise exception 'a refused batch changed entries'; end if;

  v_result := public.review_time_entries('26100000-0000-0000-0000-000000000001',
    '26100000-0000-0000-0000-000000000010', v_ids, 'approved', array['26100000-0000-0000-0000-000000000002'::uuid]);
  if v_result <> 150 or (
    select count(*) from public.time_entries
    where id = any(v_ids) and status = 'approved'
      and reviewed_by = '26100000-0000-0000-0000-000000000001' and reviewed_at is not null
  ) <> 150 then raise exception 'a clean review did not apply to every entry'; end if;

  v_result := public.delete_time_entries('26100000-0000-0000-0000-000000000001',
    '26100000-0000-0000-0000-000000000010', v_ids, array['26100000-0000-0000-0000-000000000002'::uuid]);
  if v_result <> 150 or exists (select 1 from public.time_entries where id = any(v_ids)) then
    raise exception 'a clean deletion did not apply to every entry';
  end if;
  -- Other sessions learn of each deletion through its notice.
  if (select count(*) from public.realtime_deletions
      where table_name = 'time_entries' and row_id = any(v_ids)
        and organization_id = '26100000-0000-0000-0000-000000000010') <> 150
  then raise exception 'a clean deletion did not signal every entry'; end if;
end;
$$;

reset role;

do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.review_time_entries(uuid, uuid, uuid[], text, uuid[])',
    'public.delete_time_entries(uuid, uuid, uuid[], uuid[])'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '% lost its service_role grant', v_function;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
  if has_function_privilege('service_role', 'app_private.lock_time_entry_batch(uuid, uuid, uuid[])', 'execute')
    or has_function_privilege('authenticated', 'app_private.lock_time_entry_batch(uuid, uuid, uuid[])', 'execute')
  then raise exception 'a client role can execute the batch lock step'; end if;
end;
$$;

select pg_temp.expect_period_closed('postgres delete in June', $sql$
  delete from public.time_entries where id = '26100000-0000-0000-0000-000000000030'
$sql$);
select set_config('app.time_capture_write', 'true', true);
select pg_temp.expect_period_closed('segment end edit', $sql$
  update public.time_segments set ended_at = '2026-06-16 13:00+02'
  where id = '26100000-0000-0000-0000-000000000041'
$sql$);
select pg_temp.expect_period_closed('segment delete', $sql$
  delete from public.time_segments where id = '26100000-0000-0000-0000-000000000041'
$sql$);
select pg_temp.expect_period_closed('session edit', $sql$
  update public.time_sessions set version = version + 1
  where id = '26100000-0000-0000-0000-000000000040'
$sql$);
-- A session that starts in an open month and reaches into June is refused too.
select pg_temp.expect_period_closed('session spanning into June', $sql$
  insert into public.time_sessions (
    id, organization_id, employee_record_id, user_id, status, started_at, ended_at, created_by, ended_by
  ) select '26100000-0000-0000-0000-000000000042', organization_id, id, user_id, 'closed',
    '2026-05-31 22:00+02', '2026-06-01 06:00+02', user_id, user_id
  from public.employee_records
  where organization_id = '26100000-0000-0000-0000-000000000010'
    and user_id = '26100000-0000-0000-0000-000000000002'
$sql$);
select set_config('app.time_capture_write', '', true);

-- An organization deletion cascades through its closed period.
do $$
begin
  begin
    delete from public.organizations where id = '26100000-0000-0000-0000-000000000010';
    if exists (select 1 from public.time_entries where organization_id = '26100000-0000-0000-0000-000000000010')
      or exists (select 1 from public.time_segments where organization_id = '26100000-0000-0000-0000-000000000010')
      or exists (select 1 from public.time_periods where organization_id = '26100000-0000-0000-0000-000000000010')
    then raise exception 'organization deletion left time rows'; end if;
    raise exception 'organization_delete_probe_done';
  exception when others then
    if sqlerrm <> 'organization_delete_probe_done' then raise; end if;
  end;
end;
$$;

-- A write locks the period row of its day, so a concurrent close waits for it.
-- The row is fresh: the reopen below leaves a stronger lock of this
-- transaction on the June row, which would hide the write's share lock.
do $$
declare
  v_period uuid;
begin
  insert into public.time_periods (organization_id, period_start_date, period_end_date, prepared_by)
  values ('26100000-0000-0000-0000-000000000011', '2026-07-01', '2026-07-31',
    '26100000-0000-0000-0000-000000000001')
  returning id into v_period;
  if (select xmax from public.time_periods where id = v_period) <> '0'::xid then
    raise exception 'the new period row is already locked';
  end if;
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status)
  values ('26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000011',
    'clock_in', '2026-07-20 08:00+02', true, 'approved');
  if (select xmax from public.time_periods where id = v_period) <> pg_current_xact_id()::xid then
    raise exception 'the write did not lock the period row';
  end if;
end;
$$;

-- After a reasoned reopen June accepts writes again.
do $$
declare
  v_period public.time_periods%rowtype;
begin
  select * into v_period from public.time_periods
    where organization_id = '26100000-0000-0000-0000-000000000010';
  perform public.reopen_time_period(
    '26100000-0000-0000-0000-000000000001', '26100000-0000-0000-0000-000000000010',
    v_period.id, 'Korrektur erforderlich', '26100000-0000-0000-0000-000000000054', repeat('e', 64));
  update public.time_entries set timestamp = '2026-06-15 08:30+02'
    where id = '26100000-0000-0000-0000-000000000030';
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status)
  values ('26100000-0000-0000-0000-000000000002', '26100000-0000-0000-0000-000000000010',
    'clock_in', '2026-06-20 08:00+02', true, 'pending');
  delete from public.time_entries where id = '26100000-0000-0000-0000-000000000031';
  perform set_config('app.time_capture_write', 'true', true);
  update public.time_segments set ended_at = '2026-06-16 13:00+02'
    where id = '26100000-0000-0000-0000-000000000041';
  perform set_config('app.time_capture_write', '', true);
end;
$$;

do $$
begin
  if has_function_privilege('service_role', 'app_private.guard_closed_period_time_write()', 'execute')
    or has_function_privilege('authenticated', 'app_private.assert_time_facts_period_open(uuid, date, date)', 'execute')
    or has_function_privilege('service_role', 'app_private.assert_time_facts_period_open(uuid, date, date)', 'execute')
  then raise exception 'a client role can execute the closed-period guard'; end if;
end;
$$;

rollback;
