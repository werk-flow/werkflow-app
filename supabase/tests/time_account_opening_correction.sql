-- The correction of a time account's opening date
-- (migration 20261030120000_correct_time_account_opening_date.sql): one
-- function call moves `opened_on`, books a reversal of the old opening and a
-- new opening on the corrected date, and records old date, new date and
-- reason. It never rewrites an earlier event, refuses a foreign or locked
-- account, and keeps exactly one current opening per account.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('16700000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'opening-correction-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Opening"}', now(), now()),
('16700000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'opening-correction-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Opening"}', now(), now()),
('16700000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'opening-correction-foreign@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"Opening"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('16700000-0000-0000-0000-000000000010', 'Opening correction SQL',
  '16700000-0000-0000-0000-000000000001', 'OPENCORR'),
('16700000-0000-0000-0000-000000000011', 'Foreign opening SQL',
  '16700000-0000-0000-0000-000000000003', 'OPENFRGN');
insert into public.organization_members (organization_id, user_id, role) values
('16700000-0000-0000-0000-000000000010', '16700000-0000-0000-0000-000000000002', 'employee');

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

-- Fires the deferred invariant of the current opening now, as a commit would.
create function pg_temp.check_deferred_invariants() returns void language plpgsql as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;
grant execute on function pg_temp.check_deferred_invariants() to service_role;

set local role service_role;

do $$
declare
  v_org constant uuid := '16700000-0000-0000-0000-000000000010';
  v_foreign_org constant uuid := '16700000-0000-0000-0000-000000000011';
  v_admin constant uuid := '16700000-0000-0000-0000-000000000001';
  v_employee_user constant uuid := '16700000-0000-0000-0000-000000000002';
  v_foreign_admin constant uuid := '16700000-0000-0000-0000-000000000003';
  v_employee uuid;
  v_admin_record uuid;
  v_account uuid;
  v_admin_account uuid;
  v_original_event uuid;
  v_correction uuid;
  v_replayed uuid;
  v_fingerprint text;
  v_calculation uuid;
  v_account_row public.time_accounts%rowtype;
  v_correction_row public.time_account_opening_corrections%rowtype;
begin
  select id into v_employee from public.employee_records
    where organization_id = v_org and user_id = v_employee_user;
  select id into v_admin_record from public.employee_records
    where organization_id = v_org and user_id = v_admin;
  if v_employee is null or v_admin_record is null then
    raise exception 'employee record prerequisite missing';
  end if;
  update public.employee_records set entry_date = '2026-07-01' where id in (v_employee, v_admin_record);

  -- The walkthrough case: the account opened with today's default date.
  v_account := public.open_time_account(
    v_org, v_employee, 90, '2026-10-29', 'Einführung des Zeitkontos', v_admin,
    '16700000-0000-0000-0000-000000000020', repeat('a', 64));
  select id into v_original_event from public.time_account_events
    where account_id = v_account and event_kind = 'opening_balance';
  perform pg_temp.check_deferred_invariants();

  -- September is prepared, not closed: the correction may reach under it.
  insert into public.time_periods (organization_id, period_start_date, period_end_date, prepared_by)
  values (v_org, '2026-09-01', '2026-09-30', v_admin);
  v_fingerprint := app_private.compute_p1_23_source_fingerprint(v_org, '2026-09-01', '2026-09-30');

  perform pg_temp.expect_refusal('an employee corrected an opening date',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-08-01', 'Falsches Datum', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_org, v_account, v_employee_user),
    'not_authorized');
  perform pg_temp.expect_refusal('a foreign admin reached the account through their own organization',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-08-01', 'Falsches Datum', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_foreign_org, v_account, v_foreign_admin),
    'account_not_found');
  perform pg_temp.expect_refusal('a foreign admin reached the account through its organization',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-08-01', 'Falsches Datum', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_org, v_account, v_foreign_admin),
    'not_authorized');
  perform pg_temp.expect_refusal('a correction without a reason was accepted',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-08-01', '  ', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_org, v_account, v_admin),
    'reason_required');
  perform pg_temp.expect_refusal('a correction to the same date was accepted',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-10-29', 'Falsches Datum', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_org, v_account, v_admin),
    'opening_date_unchanged');

  v_correction := public.correct_time_account_opening_date(
    v_org, v_account, '2026-08-01', 'Konto ab August führen', v_admin,
    '16700000-0000-0000-0000-000000000021', repeat('c', 64));
  perform pg_temp.check_deferred_invariants();

  select * into v_account_row from public.time_accounts where id = v_account;
  if v_account_row.opened_on <> '2026-08-01' or v_account_row.version <> 2 then
    raise exception 'the account was not moved to the corrected date (opened_on %, version %)',
      v_account_row.opened_on, v_account_row.version;
  end if;
  if v_account_row.current_balance_minutes <> 90 then
    raise exception 'the correction changed the balance to %', v_account_row.current_balance_minutes;
  end if;
  select * into v_correction_row from public.time_account_opening_corrections where id = v_correction;
  if v_correction_row.previous_opened_on <> '2026-10-29'
    or v_correction_row.corrected_opened_on <> '2026-08-01'
    or v_correction_row.reason <> 'Konto ab August führen'
    or v_correction_row.reversed_event_id <> v_original_event
    or v_correction_row.created_by <> v_admin
  then raise exception 'the history row lacks old date, new date, reason or actor'; end if;
  if not exists (
    select 1 from public.time_account_events
    where id = v_original_event and effective_date = '2026-10-29' and minutes = 90
      and reason = 'Einführung des Zeitkontos'
  ) then raise exception 'the original opening event was rewritten'; end if;
  if not exists (
    select 1 from public.time_account_events
    where id = v_correction_row.reversal_event_id and effective_date = '2026-10-29' and minutes = -90
      and reason = 'Eröffnungsdatum korrigiert von 29.10.2026 auf 01.08.2026: Konto ab August führen'
  ) or not exists (
    select 1 from public.time_account_events
    where id = v_correction_row.opening_event_id and effective_date = '2026-08-01' and minutes = 90
      and reason = 'Eröffnungsdatum korrigiert von 29.10.2026 auf 01.08.2026: Konto ab August führen'
  ) then raise exception 'the opening minutes did not move to the corrected date'; end if;
  if (select sum(minutes) from public.time_account_events where account_id = v_account) <> 90 then
    raise exception 'the account ledger no longer sums to its balance';
  end if;
  if v_fingerprint = app_private.compute_p1_23_source_fingerprint(v_org, '2026-09-01', '2026-09-30') then
    raise exception 'the correction left a prepared September calculation fresh';
  end if;

  -- A replay returns the first result; another payload under its id is refused.
  v_replayed := public.correct_time_account_opening_date(
    v_org, v_account, '2026-08-01', 'Konto ab August führen', v_admin,
    '16700000-0000-0000-0000-000000000021', repeat('c', 64));
  if v_replayed <> v_correction
    or (select count(*) from public.time_account_opening_corrections where account_id = v_account) <> 1
  then raise exception 'a replayed correction was applied twice'; end if;
  perform pg_temp.expect_refusal('a changed payload reused an operation id',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-07-01', 'Anders', %L, '16700000-0000-0000-0000-000000000021', repeat('d', 64))$sql$,
      v_org, v_account, v_admin),
    'operation_id_conflict');

  -- A second correction reverses the current opening, never an earlier one.
  v_correction := public.correct_time_account_opening_date(
    v_org, v_account, '2026-08-03', 'Erster Arbeitstag', v_admin,
    '16700000-0000-0000-0000-000000000022', repeat('e', 64));
  perform pg_temp.check_deferred_invariants();
  select * into v_correction_row from public.time_account_opening_corrections where id = v_correction;
  if v_correction_row.previous_opened_on <> '2026-08-01'
    or v_correction_row.reversed_event_id <> (
      select opening_event_id from public.time_account_opening_corrections
      where operation_id = '16700000-0000-0000-0000-000000000021'
    )
  then raise exception 'the second correction did not reverse the current opening'; end if;

  -- Exactly one current opening per account, on the account's opening date.
  perform pg_temp.expect_refusal('a second opening event was booked without a correction',
    format($sql$
      insert into public.time_account_events(organization_id, account_id, employee_record_id, event_kind,
        effective_date, minutes, reason, operation_id, request_hash, created_by)
      values (%L, %L, %L, 'opening_balance', '2026-07-01', 30, 'Zweite Eröffnung', gen_random_uuid(),
        repeat('f', 64), %L);
      set constraints all immediate;
    $sql$, v_org, v_account, v_employee, v_admin),
    'opening_event_conflict');
  set constraints all deferred;

  -- The history is never rewritten or removed.
  perform pg_temp.expect_refusal('the service role rewrote a correction row',
    format($sql$update public.time_account_opening_corrections set reason = 'Anders' where id = %L$sql$,
      v_correction),
    'permission denied for table time_account_opening_corrections');
  perform pg_temp.expect_refusal('the service role deleted a correction row',
    format($sql$delete from public.time_account_opening_corrections where id = %L$sql$, v_correction),
    'permission denied for table time_account_opening_corrections');

  -- August closes through the real prepare and close. The opening on 03.08.
  -- is then locked, before and after it.
  v_admin_account := public.open_time_account(
    v_org, v_admin_record, 0, '2026-10-15', 'Einführung des Zeitkontos', v_admin,
    '16700000-0000-0000-0000-000000000023', repeat('a', 64));
  v_calculation := public.prepare_time_period(
    v_admin, v_org, '2026-08-01', '2026-08-31',
    app_private.compute_p1_23_source_fingerprint(v_org, '2026-08-01', '2026-08-31'),
    (select jsonb_agg(jsonb_build_object(
      'id', gen_random_uuid(), 'employee_record_id', record_id,
      'policy_version_id', null, 'previous_balance_minutes', 0, 'target_minutes', 0,
      'source_seconds', 0, 'source_minutes', 0, 'credited_minutes', 0, 'vacation_minutes', 0,
      'sickness_minutes', 0, 'account_event_minutes', 0, 'period_delta_minutes', 0,
      'overtime_candidate_minutes', 0, 'closing_balance_minutes', 0, 'authoritative_targets', false))
     from unnest(array[v_admin_record, v_employee]) as person(record_id)),
    '[]', '[]', '[]', '16700000-0000-0000-0000-000000000030', repeat('9', 64));
  perform public.close_time_period(
    v_admin, v_org, (select period_id from public.time_period_calculations where id = v_calculation),
    '16700000-0000-0000-0000-000000000031', repeat('9', 64));
  if (select state from public.time_periods where organization_id = v_org and period_start_date = '2026-08-01')
    <> 'closed' then raise exception 'the period workflow did not close August'; end if;
  perform pg_temp.expect_refusal('a correction moved an opening that a closed month used',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-09-01', 'Später', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_org, v_account, v_admin),
    'opening_date_locked');
  perform pg_temp.expect_refusal('a correction moved an opening under a closed month',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-07-01', 'Früher', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_org, v_account, v_admin),
    'opening_date_locked');

  -- An account opened after the closed month moves freely after it, never into it.
  perform pg_temp.expect_refusal('a correction moved an opening into a closed month',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-08-15', 'Früher', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_org, v_admin_account, v_admin),
    'opening_date_locked');
  perform pg_temp.expect_refusal('a correction moved an opening across a closed month',
    format($sql$select public.correct_time_account_opening_date(%L, %L, '2026-07-15', 'Früher', %L, gen_random_uuid(), repeat('b', 64))$sql$,
      v_org, v_admin_account, v_admin),
    'opening_date_locked');
  perform public.correct_time_account_opening_date(
    v_org, v_admin_account, '2026-09-01', 'Ab September', v_admin,
    '16700000-0000-0000-0000-000000000024', repeat('a', 64));
  perform pg_temp.check_deferred_invariants();
  if (select opened_on from public.time_accounts where id = v_admin_account) <> '2026-09-01' then
    raise exception 'an account opened after the last closed month could not be corrected';
  end if;
end;
$$;

reset role;

-- The owner role bypasses the grants: a correction row that does not match
-- its events is still refused, and the history still stays as written.
do $$
declare
  v_correction uuid;
begin
  select id into v_correction from public.time_account_opening_corrections
    where operation_id = '16700000-0000-0000-0000-000000000022';
  perform pg_temp.expect_refusal('a correction row swapped its events',
    format($sql$
      insert into public.time_account_opening_corrections(organization_id, account_id,
        previous_opened_on, corrected_opened_on, reason, reversed_event_id, reversal_event_id,
        opening_event_id, operation_id, request_hash, created_by)
      select organization_id, account_id, '2026-08-03', '2026-07-01', 'Ohne Buchung', opening_event_id,
        reversal_event_id, reversed_event_id, gen_random_uuid(), repeat('f', 64), created_by
      from public.time_account_opening_corrections where id = %L
    $sql$, v_correction),
    'opening_correction_mismatch');
  perform pg_temp.expect_refusal('a correction row was rewritten',
    format($sql$update public.time_account_opening_corrections set reason = 'Anders' where id = %L$sql$,
      v_correction),
    'p1_23_history_immutable');
  perform pg_temp.expect_refusal('a correction row was deleted',
    format($sql$delete from public.time_account_opening_corrections where id = %L$sql$, v_correction),
    'p1_23_history_immutable');
end;
$$;

-- The opening date changes only together with its ledger: a bare change of
-- `opened_on`, or an account without an opening event, fails at commit.
do $$
declare
  v_org constant uuid := '16700000-0000-0000-0000-000000000010';
begin
  perform pg_temp.expect_refusal('opened_on moved without a correction',
    format($sql$
      update public.time_accounts set opened_on = '2026-07-01' where id = (
        select account_id from public.time_account_opening_corrections
        where operation_id = '16700000-0000-0000-0000-000000000022');
      set constraints all immediate;
    $sql$),
    'opening_event_conflict');
  set constraints all deferred;
  perform pg_temp.expect_refusal('an account was opened without an opening event',
    format($sql$
      insert into public.time_accounts (organization_id, employee_record_id, opened_on, opened_by)
      select organization_id, id, '2026-09-01', '16700000-0000-0000-0000-000000000003'
      from public.employee_records where organization_id = %L;
      set constraints all immediate;
    $sql$, '16700000-0000-0000-0000-000000000011'),
    'opening_event_conflict');
  set constraints all deferred;
end;
$$;

-- An organization deletion still removes the history with its accounts.
do $$
begin
  delete from public.organizations where id = '16700000-0000-0000-0000-000000000010';
  if exists (
    select 1 from public.time_account_opening_corrections
    where organization_id = '16700000-0000-0000-0000-000000000010'
  ) then raise exception 'the organization deletion left opening corrections'; end if;
end;
$$;

-- No client role reads or writes the history, or calls the correction.
do $$
begin
  if has_table_privilege('authenticated', 'public.time_account_opening_corrections', 'SELECT')
    or has_table_privilege('anon', 'public.time_account_opening_corrections', 'SELECT')
    or has_table_privilege('service_role', 'public.time_account_opening_corrections', 'INSERT')
    or has_table_privilege('service_role', 'public.time_account_opening_corrections', 'UPDATE')
    or has_table_privilege('service_role', 'public.time_account_opening_corrections', 'DELETE')
  then raise exception 'a role kept direct access to the opening corrections'; end if;
  if has_function_privilege('authenticated',
      'public.correct_time_account_opening_date(uuid,uuid,date,text,uuid,uuid,text)', 'EXECUTE')
    or has_function_privilege('anon',
      'public.correct_time_account_opening_date(uuid,uuid,date,text,uuid,uuid,text)', 'EXECUTE')
  then raise exception 'a client role can correct an opening date'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.time_account_opening_corrections'::regclass)
  then raise exception 'the opening corrections table has no row level security'; end if;
end;
$$;

rollback;
