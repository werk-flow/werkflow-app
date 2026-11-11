-- Opening several time accounts with one shared date and reason
-- (migration 20261201090000_open_time_accounts_together.sql): one function
-- call opens every named account or none, records one account and one
-- opening event per person with that person's balance, refuses a foreign
-- person or caller, and never opens on or before a closed month.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('16800000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bulk-opening-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Bulk"}', now(), now()),
('16800000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bulk-opening-first@example.test', '', now(), '{}',
 '{"first_name":"First","last_name":"Bulk"}', now(), now()),
('16800000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bulk-opening-foreign@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"Bulk"}', now(), now()),
('16800000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bulk-opening-second@example.test', '', now(), '{}',
 '{"first_name":"Second","last_name":"Bulk"}', now(), now()),
('16800000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'bulk-opening-third@example.test', '', now(), '{}',
 '{"first_name":"Third","last_name":"Bulk"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('16800000-0000-0000-0000-000000000010', 'Bulk opening SQL',
  '16800000-0000-0000-0000-000000000001', 'BULKOPEN'),
('16800000-0000-0000-0000-000000000011', 'Foreign bulk opening SQL',
  '16800000-0000-0000-0000-000000000003', 'BULKFRGN');
insert into public.organization_members (organization_id, user_id, role) values
('16800000-0000-0000-0000-000000000010', '16800000-0000-0000-0000-000000000002', 'employee'),
('16800000-0000-0000-0000-000000000010', '16800000-0000-0000-0000-000000000004', 'employee'),
('16800000-0000-0000-0000-000000000010', '16800000-0000-0000-0000-000000000005', 'employee');

-- Runs one statement and requires the refusal `p_message`.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_message text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_message then
      raise exception '%: expected %, got %', p_label, p_message, sqlerrm;
    end if;
    return;
  end;
  raise exception '%: the statement was accepted', p_label;
end;
$$;

-- One opening of the organization's people as the function takes it.
create function pg_temp.openings(p_people uuid[], p_minutes integer[]) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('employee_record_id', person, 'opening_minutes', minutes))
  from unnest(p_people, p_minutes) as opening(person, minutes);
$$;

grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;
grant execute on function pg_temp.openings(uuid[], integer[]) to service_role;

set local role service_role;

do $$
declare
  v_org constant uuid := '16800000-0000-0000-0000-000000000010';
  v_foreign_org constant uuid := '16800000-0000-0000-0000-000000000011';
  v_admin constant uuid := '16800000-0000-0000-0000-000000000001';
  v_employee_user constant uuid := '16800000-0000-0000-0000-000000000002';
  v_foreign_admin constant uuid := '16800000-0000-0000-0000-000000000003';
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_foreign_record uuid;
  v_opened integer;
  v_calculation uuid;
  v_event_count integer;
begin
  select id into v_first from public.employee_records
    where organization_id = v_org and user_id = v_employee_user;
  select id into v_second from public.employee_records
    where organization_id = v_org and user_id = '16800000-0000-0000-0000-000000000004';
  select id into v_third from public.employee_records
    where organization_id = v_org and user_id = '16800000-0000-0000-0000-000000000005';
  select id into v_foreign_record from public.employee_records
    where organization_id = v_foreign_org and user_id = v_foreign_admin;
  if v_first is null or v_second is null or v_third is null or v_foreign_record is null then
    raise exception 'employee record prerequisite missing';
  end if;
  -- First and second work through August; the Admin and the third person enter in
  -- September, so August's population is the first two.
  update public.employee_records set entry_date = '2026-07-01' where id in (v_first, v_second);
  update public.employee_records set entry_date = '2026-09-01'
    where id = v_third or (organization_id = v_org and user_id = v_admin);

  -- Who may open: only an Admin of the organization, for its own people.
  perform pg_temp.expect_refusal('an employee opened time accounts',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L, %L]::uuid[], array[0, 0]), '2026-08-01', 'Einführung', repeat('a', 64))$sql$,
      v_employee_user, v_org, v_first, v_second),
    'not_authorized');
  perform pg_temp.expect_refusal('a foreign admin opened accounts through the organization',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L]::uuid[], array[0]), '2026-08-01', 'Einführung', repeat('a', 64))$sql$,
      v_foreign_admin, v_org, v_first),
    'not_authorized');
  perform pg_temp.expect_refusal('a foreign admin reached the people through their own organization',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L]::uuid[], array[0]), '2026-08-01', 'Einführung', repeat('a', 64))$sql$,
      v_foreign_admin, v_foreign_org, v_first),
    'employee_not_found');

  -- What must be complete: a reason, a date, distinct people with whole minutes.
  perform pg_temp.expect_refusal('an opening without a reason was accepted',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L]::uuid[], array[0]), '2026-08-01', '  ', repeat('a', 64))$sql$,
      v_admin, v_org, v_first),
    'reason_required');
  perform pg_temp.expect_refusal('an opening before 2000 reached its month locks',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L]::uuid[], array[0]), '1999-12-31', 'Einführung', repeat('a', 64))$sql$,
      v_admin, v_org, v_first),
    'invalid_input');
  perform pg_temp.expect_refusal('an empty opening was accepted',
    format($sql$select public.open_time_accounts(%L, %L, '[]', '2026-08-01', 'Einführung', repeat('a', 64))$sql$,
      v_admin, v_org),
    'invalid_input');
  perform pg_temp.expect_refusal('one person was opened twice in one call',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L, %L]::uuid[], array[0, 30]), '2026-08-01', 'Einführung', repeat('a', 64))$sql$,
      v_admin, v_org, v_first, v_first),
    'invalid_input');
  perform pg_temp.expect_refusal('a balance with a fraction of a minute was accepted',
    format($sql$select public.open_time_accounts(%L, %L, jsonb_build_array(jsonb_build_object('employee_record_id', %L, 'opening_minutes', 1.5)), '2026-08-01', 'Einführung', repeat('a', 64))$sql$,
      v_admin, v_org, v_first),
    'invalid_input');
  perform pg_temp.expect_refusal('a balance as text was accepted',
    format($sql$select public.open_time_accounts(%L, %L, jsonb_build_array(jsonb_build_object('employee_record_id', %L, 'opening_minutes', '12:30')), '2026-08-01', 'Einführung', repeat('a', 64))$sql$,
      v_admin, v_org, v_first),
    'invalid_input');

  -- All or nothing: a foreign person in the list opens nobody.
  perform pg_temp.expect_refusal('a foreign person was opened with the organization''s people',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L, %L, %L]::uuid[], array[0, 0, 0]), '2026-08-01', 'Einführung', repeat('a', 64))$sql$,
      v_admin, v_org, v_first, v_second, v_foreign_record),
    'employee_not_found');
  if exists (select 1 from public.time_accounts where organization_id in (v_org, v_foreign_org)) then
    raise exception 'a refused bulk opening left an account behind';
  end if;

  -- One call, one account and one opening event per person, each with its balance.
  v_opened := public.open_time_accounts(
    v_admin, v_org, pg_temp.openings(array[v_first, v_second], array[750, -195]),
    '2026-08-01', 'Einführung des Zeitkontos', repeat('b', 64));
  if v_opened <> 2 then raise exception 'the bulk opening reported % accounts, not 2', v_opened; end if;
  if (select array_agg(current_balance_minutes order by current_balance_minutes)
      from public.time_accounts
      where organization_id = v_org and employee_record_id in (v_first, v_second)
        and opened_on = '2026-08-01' and opened_by = v_admin)
    is distinct from array[-195, 750] then
    raise exception 'the bulk opening did not open both accounts on the shared date with their own balances';
  end if;
  select count(*) into v_event_count from public.time_account_events event
    join public.time_accounts account on account.id = event.account_id
    where event.organization_id = v_org and event.event_kind = 'opening_balance'
      and event.effective_date = '2026-08-01' and event.reason = 'Einführung des Zeitkontos'
      and event.created_by = v_admin and event.minutes = account.current_balance_minutes
      and event.employee_record_id = account.employee_record_id;
  if v_event_count <> 2 then
    raise exception 'the bulk opening recorded % opening events, not one per person', v_event_count;
  end if;
  if (select count(distinct operation_id) from public.time_account_events
      where organization_id = v_org and event_kind = 'opening_balance') <> 2 then
    raise exception 'the openings of two people share one operation';
  end if;

  -- An account that is already open refuses the whole call.
  perform pg_temp.expect_refusal('an open account was opened again',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L, %L]::uuid[], array[0, 0]), '2026-08-01', 'Einführung', repeat('c', 64))$sql$,
      v_admin, v_org, v_third, v_first),
    'account_already_open');
  if exists (select 1 from public.time_accounts where employee_record_id = v_third) then
    raise exception 'a refused bulk opening opened the third person';
  end if;

  -- August closes through the real prepare and close. A shared date on or
  -- before its end would change the balance it carried forward.
  v_calculation := public.prepare_time_period(
    v_admin, v_org, '2026-08-01', '2026-08-31',
    app_private.compute_p1_23_source_fingerprint(v_org, '2026-08-01', '2026-08-31'),
    (select jsonb_agg(jsonb_build_object(
      'id', gen_random_uuid(), 'employee_record_id', record_id,
      'policy_version_id', null, 'previous_balance_minutes', 0, 'target_minutes', 0,
      'source_seconds', 0, 'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
      'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
      'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0, 'authoritative_targets', false))
     from unnest(array[v_first, v_second]) as person(record_id)),
    '[]', '[]', '[]', '16800000-0000-0000-0000-000000000030', repeat('9', 64));
  perform public.close_time_period(
    v_admin, v_org, (select period_id from public.time_period_calculations where id = v_calculation),
    '16800000-0000-0000-0000-000000000031', repeat('9', 64));
  if (select state from public.time_periods where organization_id = v_org and period_start_date = '2026-08-01')
    <> 'closed' then raise exception 'the period workflow did not close August'; end if;
  perform pg_temp.expect_refusal('a bulk opening reached into a closed month',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L]::uuid[], array[0]), '2026-08-15', 'Einführung', repeat('d', 64))$sql$,
      v_admin, v_org, v_third),
    'opening_date_locked');
  perform pg_temp.expect_refusal('a bulk opening reached under a closed month',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L]::uuid[], array[0]), '2026-07-01', 'Einführung', repeat('d', 64))$sql$,
      v_admin, v_org, v_third),
    'opening_date_locked');
  perform pg_temp.expect_refusal('a bulk opening on the last day of a closed month was accepted',
    format($sql$select public.open_time_accounts(%L, %L, pg_temp.openings(array[%L]::uuid[], array[0]), '2026-08-31', 'Einführung', repeat('d', 64))$sql$,
      v_admin, v_org, v_third),
    'opening_date_locked');
  v_opened := public.open_time_accounts(
    v_admin, v_org, pg_temp.openings(array[v_third], array[0]),
    '2026-09-01', 'Eintritt nach dem August', repeat('e', 64));
  if v_opened <> 1 or not exists (
    select 1 from public.time_accounts where employee_record_id = v_third and opened_on = '2026-09-01'
  ) then
    raise exception 'an opening after the last closed month was refused';
  end if;
end;
$$;

reset role;

-- Only the server calls the function.
do $$
begin
  if has_function_privilege('authenticated',
      'public.open_time_accounts(uuid,uuid,jsonb,date,text,text)', 'EXECUTE')
    or has_function_privilege('anon',
      'public.open_time_accounts(uuid,uuid,jsonb,date,text,text)', 'EXECUTE')
  then raise exception 'a client role can open time accounts'; end if;
  if not has_function_privilege('service_role',
      'public.open_time_accounts(uuid,uuid,jsonb,date,text,text)', 'EXECUTE')
  then raise exception 'the server cannot open time accounts'; end if;
end;
$$;

rollback;
