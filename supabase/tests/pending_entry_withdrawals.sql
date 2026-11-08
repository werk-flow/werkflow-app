-- Withdrawn manual submissions (migration 20261109090000_withdraw_pending_manual_entries.sql):
-- the author of a pending manual entry withdraws it before the decision. The
-- entries leave the time record and one withdrawal event per entry keeps the
-- author, the time and the entry as submitted. Another person's entry, a
-- decided entry, a clocked entry and an entry of another organization are
-- refused, and a refusal withdraws nothing of its batch. The withdrawal ledger
-- is append-only, for the table owner too, and closed to client roles.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('28200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'withdrawal-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Withdrawal"}', now(), now()),
('28200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'withdrawal-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Withdrawal"}', now(), now()),
('28200000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'withdrawal-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"Withdrawal"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('28200000-0000-0000-0000-000000000010', 'Withdrawals SQL',
  '28200000-0000-0000-0000-000000000001', 'WITHDRSQ'),
('28200000-0000-0000-0000-000000000011', 'Withdrawals SQL other',
  '28200000-0000-0000-0000-000000000001', 'WITHDRS2');
insert into public.organization_members (organization_id, user_id, role) values
('28200000-0000-0000-0000-000000000010', '28200000-0000-0000-0000-000000000002', 'employee'),
('28200000-0000-0000-0000-000000000010', '28200000-0000-0000-0000-000000000003', 'employee'),
('28200000-0000-0000-0000-000000000011', '28200000-0000-0000-0000-000000000002', 'employee');

-- 21 and 22: the employee's pending manual pair. 23: the employee's approved
-- entry. 24: the employee's pending entry that was not entered by hand.
-- 25: the colleague's pending entry. 26: the employee's pending entry in the
-- other organization.
insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp, is_manual, status) values
('28200000-0000-0000-0000-000000000021', '28200000-0000-0000-0000-000000000002',
  '28200000-0000-0000-0000-000000000010', 'clock_in', now() - interval '3 hours', true, 'pending'),
('28200000-0000-0000-0000-000000000022', '28200000-0000-0000-0000-000000000002',
  '28200000-0000-0000-0000-000000000010', 'clock_out', now() - interval '1 hour', true, 'pending'),
('28200000-0000-0000-0000-000000000023', '28200000-0000-0000-0000-000000000002',
  '28200000-0000-0000-0000-000000000010', 'clock_in', now() - interval '6 hours', true, 'approved'),
('28200000-0000-0000-0000-000000000024', '28200000-0000-0000-0000-000000000002',
  '28200000-0000-0000-0000-000000000010', 'clock_out', now(), false, 'pending'),
('28200000-0000-0000-0000-000000000025', '28200000-0000-0000-0000-000000000003',
  '28200000-0000-0000-0000-000000000010', 'clock_in', now() - interval '3 hours', true, 'pending'),
('28200000-0000-0000-0000-000000000026', '28200000-0000-0000-0000-000000000002',
  '28200000-0000-0000-0000-000000000011', 'clock_in', now() - interval '3 hours', true, 'pending');

create temporary table expected_refusals (label text, statement text, refusal text) on commit drop;
grant all on table pg_temp.expected_refusals to service_role;
insert into pg_temp.expected_refusals values
('withdrawal of a colleague''s pending entry', $sql$
  select public.withdraw_pending_time_entries('28200000-0000-0000-0000-000000000002',
    '28200000-0000-0000-0000-000000000010', array['28200000-0000-0000-0000-000000000025'::uuid])
$sql$, 'not_authorized'),
('withdrawal of an own pending entry together with a colleague''s', $sql$
  select public.withdraw_pending_time_entries('28200000-0000-0000-0000-000000000002',
    '28200000-0000-0000-0000-000000000010',
    array['28200000-0000-0000-0000-000000000021', '28200000-0000-0000-0000-000000000025']::uuid[])
$sql$, 'not_authorized'),
('withdrawal by an Admin of an employee''s pending entry', $sql$
  select public.withdraw_pending_time_entries('28200000-0000-0000-0000-000000000001',
    '28200000-0000-0000-0000-000000000010', array['28200000-0000-0000-0000-000000000021'::uuid])
$sql$, 'not_authorized'),
('withdrawal of an own approved entry', $sql$
  select public.withdraw_pending_time_entries('28200000-0000-0000-0000-000000000002',
    '28200000-0000-0000-0000-000000000010',
    array['28200000-0000-0000-0000-000000000022', '28200000-0000-0000-0000-000000000023']::uuid[])
$sql$, 'entry_not_pending'),
('withdrawal of an own pending entry that was not entered by hand', $sql$
  select public.withdraw_pending_time_entries('28200000-0000-0000-0000-000000000002',
    '28200000-0000-0000-0000-000000000010', array['28200000-0000-0000-0000-000000000024'::uuid])
$sql$, 'entry_not_pending'),
('withdrawal of an own entry of another organization', $sql$
  select public.withdraw_pending_time_entries('28200000-0000-0000-0000-000000000002',
    '28200000-0000-0000-0000-000000000010', array['28200000-0000-0000-0000-000000000026'::uuid])
$sql$, 'entry_not_found'),
('withdrawal that names an entry twice', $sql$
  select public.withdraw_pending_time_entries('28200000-0000-0000-0000-000000000002',
    '28200000-0000-0000-0000-000000000010',
    array['28200000-0000-0000-0000-000000000021', '28200000-0000-0000-0000-000000000021']::uuid[])
$sql$, 'invalid_input');

set local role service_role;

do $$
declare
  v_case record;
  v_refusal text;
begin
  for v_case in select * from pg_temp.expected_refusals loop
    v_refusal := null;
    begin
      execute v_case.statement;
    exception when raise_exception then
      v_refusal := sqlerrm;
    end;
    if v_refusal is distinct from v_case.refusal then
      raise exception '% ended with % instead of %', v_case.label, coalesce(v_refusal, 'acceptance'), v_case.refusal;
    end if;
  end loop;
  if (select count(*) from public.time_entries
      where organization_id in ('28200000-0000-0000-0000-000000000010', '28200000-0000-0000-0000-000000000011')) <> 6
    or exists (select 1 from public.time_entry_withdrawals
      where organization_id in ('28200000-0000-0000-0000-000000000010', '28200000-0000-0000-0000-000000000011'))
  then raise exception 'a refused withdrawal changed something'; end if;
end;
$$;

do $$
declare
  v_org constant uuid := '28200000-0000-0000-0000-000000000010';
  v_employee constant uuid := '28200000-0000-0000-0000-000000000002';
  v_clock_in_at timestamptz;
  v_event public.time_entry_withdrawals;
begin
  select timestamp into v_clock_in_at from public.time_entries where id = '28200000-0000-0000-0000-000000000021';

  -- The author withdraws the whole pending submission in one call.
  if public.withdraw_pending_time_entries(v_employee, v_org,
    array['28200000-0000-0000-0000-000000000021', '28200000-0000-0000-0000-000000000022']::uuid[]) <> 2
  then raise exception 'the withdrawal did not remove the submission'; end if;
  if exists (select 1 from public.time_entries
    where id in ('28200000-0000-0000-0000-000000000021', '28200000-0000-0000-0000-000000000022'))
  then raise exception 'a withdrawn entry stayed in the time record'; end if;
  if (select count(*) from public.time_entries where organization_id = v_org) <> 3
  then raise exception 'the withdrawal touched an entry it did not name'; end if;

  if (select count(*) from public.time_entry_withdrawals where organization_id = v_org) <> 2
  then raise exception 'the withdrawal did not record one event per entry'; end if;
  select * into strict v_event from public.time_entry_withdrawals
  where organization_id = v_org and entry_id = '28200000-0000-0000-0000-000000000021';
  if v_event.actor_id <> v_employee or v_event.entry_timestamp <> v_clock_in_at
    or v_event.withdrawn_entry ->> 'entry_type' <> 'clock_in'
    or (v_event.withdrawn_entry ->> 'timestamp')::timestamptz <> v_clock_in_at
  then raise exception 'the withdrawal was not recorded as it happened: %', row_to_json(v_event); end if;

  -- The record is append-only, also for the service role.
  begin
    update public.time_entry_withdrawals set actor_id = gen_random_uuid() where organization_id = v_org;
    raise exception 'a withdrawal event update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.time_entry_withdrawals where organization_id = v_org;
    raise exception 'a withdrawal event delete was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

-- The event-history guard refuses a rewrite by the table owner too.
do $$
begin
  begin
    update public.time_entry_withdrawals set actor_id = gen_random_uuid()
    where organization_id = '28200000-0000-0000-0000-000000000010';
    raise exception 'an owner rewrite of a withdrawal event was accepted';
  exception when raise_exception then
    if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
  end;
  begin
    delete from public.time_entry_withdrawals where organization_id = '28200000-0000-0000-0000-000000000010';
    raise exception 'an owner delete of a withdrawal event was accepted';
  exception when raise_exception then
    if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.time_entry_withdrawals', 'select')
      or has_table_privilege(v_role, 'public.time_entry_withdrawals', 'insert')
      or has_function_privilege(v_role, 'public.withdraw_pending_time_entries(uuid, uuid, uuid[])', 'execute')
    then raise exception '% reaches the withdrawal of pending entries', v_role; end if;
  end loop;
  if not has_function_privilege('service_role', 'public.withdraw_pending_time_entries(uuid, uuid, uuid[])', 'execute')
  then raise exception 'withdraw_pending_time_entries lost its service_role grant'; end if;
end;
$$;

-- The organization's deletion takes its withdrawal events with it.
delete from public.organizations where id = '28200000-0000-0000-0000-000000000010';
do $$
begin
  if exists (select 1 from public.time_entry_withdrawals
    where organization_id = '28200000-0000-0000-0000-000000000010')
  then raise exception 'an organization deletion left withdrawal events'; end if;
end;
$$;

rollback;
