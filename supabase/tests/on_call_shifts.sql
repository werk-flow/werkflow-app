-- Bereitschaft (20261205091400_plan_and_hand_over_on_call_shifts.sql,
-- werk-flow/werkflow-planning#469). Admin and Büro plan, change, end and hand
-- over shifts; each write keeps its history in the same call, and a change
-- after the start keeps the earlier version. Another shift with the same
-- label in the same time needs a confirmation. An employee reads the shifts
-- and their people of their organization and writes none; a foreign
-- organization reads nothing; no browser role reads the history or who
-- planned a shift. One rolled-back transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select person.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  person.email, '', now(), '{}', jsonb_build_object('first_name', person.first_name, 'last_name', 'Muster'),
  now(), now()
from (values
  ('46900000-0000-4000-8000-000000000001'::uuid, 'on-call-admin@example.test', 'Admin'),
  ('46900000-0000-4000-8000-000000000002'::uuid, 'on-call-buero@example.test', 'Erika'),
  ('46900000-0000-4000-8000-000000000003'::uuid, 'on-call-employee@example.test', 'Max'),
  ('46900000-0000-4000-8000-000000000004'::uuid, 'on-call-second@example.test', 'Lena'),
  ('46900000-0000-4000-8000-000000000005'::uuid, 'on-call-foreign-admin@example.test', 'Fremd'),
  ('46900000-0000-4000-8000-000000000006'::uuid, 'on-call-foreign@example.test', 'Fremda')
) as person(id, email, first_name);

insert into public.organizations (id, name, admin_id, unique_code) values
  ('46900000-0000-4000-8000-0000000000a0', 'Haustechnik Sonnenberg GmbH',
   '46900000-0000-4000-8000-000000000001', 'ONCALLA'),
  ('46900000-0000-4000-8000-0000000000b0', 'Hausverwaltung Lindenhof GmbH',
   '46900000-0000-4000-8000-000000000005', 'ONCALLB');
insert into public.organization_members (organization_id, user_id, role) values
  ('46900000-0000-4000-8000-0000000000a0', '46900000-0000-4000-8000-000000000002', 'buero'),
  ('46900000-0000-4000-8000-0000000000a0', '46900000-0000-4000-8000-000000000003', 'employee'),
  ('46900000-0000-4000-8000-0000000000a0', '46900000-0000-4000-8000-000000000004', 'employee'),
  ('46900000-0000-4000-8000-0000000000b0', '46900000-0000-4000-8000-000000000006', 'employee');

create function pg_temp.record_of(p_user_id uuid) returns uuid language sql as $$
  select id from public.employee_records where user_id = p_user_id;
$$;

-- Runs one call and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;

-- Plans a shift of organization A as the Büro member.
create function pg_temp.plan(
  p_shift_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_label text, p_members uuid[],
  p_confirm boolean default false
) returns jsonb language sql as $$
  select public.plan_on_call_shift(
    '46900000-0000-4000-8000-000000000002', '46900000-0000-4000-8000-0000000000a0', p_shift_id,
    p_starts_at, p_ends_at, p_label, 'Schlüssel liegt im Fahrzeug', p_members, p_confirm
  );
$$;

do $$
declare
  v_max uuid := pg_temp.record_of('46900000-0000-4000-8000-000000000003');
  v_lena uuid := pg_temp.record_of('46900000-0000-4000-8000-000000000004');
  v_foreign uuid := pg_temp.record_of('46900000-0000-4000-8000-000000000006');
  v_result jsonb;
begin
  -- A running shift „Heizung“ since yesterday evening, and a planned one.
  v_result := pg_temp.plan('46900000-0000-4000-8000-000000000101', now() - interval '14 hours',
    now() + interval '2 days', 'Heizung', array[v_max]);
  if (v_result ->> 'version')::integer is distinct from 1 then
    raise exception 'planning a shift does not answer its first version';
  end if;
  perform pg_temp.plan('46900000-0000-4000-8000-000000000102', now() + interval '3 days',
    now() + interval '5 days', null, array[v_lena]);
  -- A repeated call under the same id writes nothing.
  perform pg_temp.plan('46900000-0000-4000-8000-000000000102', now() + interval '3 days',
    now() + interval '5 days', null, array[v_lena]);
  if (select count(*) from public.on_call_shift_events
      where organization_id = '46900000-0000-4000-8000-0000000000a0'
        and shift_id = '46900000-0000-4000-8000-000000000102') <> 1 then
    raise exception 'a repeated plan wrote a second history row';
  end if;

  perform pg_temp.expect_refusal('an employee planning',
    format('select public.plan_on_call_shift(%L, %L, gen_random_uuid(), now(), now() + interval ''1 day'', null, '''', %L, false)',
      '46900000-0000-4000-8000-000000000003', '46900000-0000-4000-8000-0000000000a0', array[v_max]),
    'not_authorized');
  perform pg_temp.expect_refusal('a foreign Admin planning in A',
    format('select public.plan_on_call_shift(%L, %L, gen_random_uuid(), now(), now() + interval ''1 day'', null, '''', %L, false)',
      '46900000-0000-4000-8000-000000000005', '46900000-0000-4000-8000-0000000000a0', array[v_foreign]),
    'not_authorized');
  perform pg_temp.expect_refusal('a person of another organization',
    format('select pg_temp.plan(gen_random_uuid(), now() + interval ''6 days'', now() + interval ''7 days'', null, %L)',
      array[v_foreign]),
    'on_call_member_invalid');
  perform pg_temp.expect_refusal('a shift without people',
    'select pg_temp.plan(gen_random_uuid(), now() + interval ''6 days'', now() + interval ''7 days'', null, ''{}'')',
    'on_call_member_required');
  perform pg_temp.expect_refusal('a shift that ends before it starts',
    format('select pg_temp.plan(gen_random_uuid(), now() + interval ''7 days'', now() + interval ''6 days'', null, %L)',
      array[v_max]),
    'on_call_shift_invalid_range');
  perform pg_temp.expect_refusal('a shift in the past',
    format('select pg_temp.plan(gen_random_uuid(), now() - interval ''2 days'', now() - interval ''1 day'', null, %L)',
      array[v_max]),
    'on_call_shift_in_past');
  -- The same label in the same time asks first; another label does not.
  perform pg_temp.expect_refusal('an unconfirmed overlap with the same label',
    format('select pg_temp.plan(%L, now() + interval ''1 day'', now() + interval ''3 days'', ''Heizung'', %L)',
      '46900000-0000-4000-8000-000000000103', array[v_lena]),
    'on_call_shift_overlaps');
  perform pg_temp.plan('46900000-0000-4000-8000-000000000103', now() + interval '1 day',
    now() + interval '3 days', 'Heizung', array[v_lena], true);
  perform pg_temp.plan('46900000-0000-4000-8000-000000000104', now() - interval '1 hour',
    now() + interval '1 day', 'Sanitär', array[v_lena]);
  if (select count(*) from public.on_call_shifts
      where organization_id = '46900000-0000-4000-8000-0000000000a0') <> 4 then
    raise exception 'a refused plan left a shift behind';
  end if;
end;
$$;

-- A change after the start keeps the start and the earlier version in the history.
do $$
declare
  v_max uuid := pg_temp.record_of('46900000-0000-4000-8000-000000000003');
  v_lena uuid := pg_temp.record_of('46900000-0000-4000-8000-000000000004');
  v_started timestamptz;
begin
  select starts_at into strict v_started from public.on_call_shifts
  where id = '46900000-0000-4000-8000-000000000101';
  perform pg_temp.expect_refusal('moving the start of a running shift',
    format('select public.change_on_call_shift(%L, %L, %L, 1, now(), now() + interval ''2 days'', ''Heizung'', '''', %L, true)',
      '46900000-0000-4000-8000-000000000002', '46900000-0000-4000-8000-0000000000a0',
      '46900000-0000-4000-8000-000000000101', array[v_max]),
    'on_call_shift_started');
  perform public.change_on_call_shift('46900000-0000-4000-8000-000000000002',
    '46900000-0000-4000-8000-0000000000a0', '46900000-0000-4000-8000-000000000101', 1, v_started,
    now() + interval '1 day', 'Heizung', 'Kundin Musterfrau ruft wegen Therme an', array[v_max, v_lena], true);
  perform pg_temp.expect_refusal('a change on a version already changed',
    format('select public.change_on_call_shift(%L, %L, %L, 1, %L, now() + interval ''2 days'', ''Heizung'', '''', %L, true)',
      '46900000-0000-4000-8000-000000000002', '46900000-0000-4000-8000-0000000000a0',
      '46900000-0000-4000-8000-000000000101', v_started, array[v_max]),
    'on_call_shift_changed');
  if (select count(*) from public.on_call_shift_events
      where shift_id = '46900000-0000-4000-8000-000000000101'
        and organization_id = '46900000-0000-4000-8000-0000000000a0'
        and ((version = 1 and kind = 'planned' and member_ids = array[v_max]
            and handover_note = 'Schlüssel liegt im Fahrzeug')
          or (version = 2 and kind = 'changed' and cardinality(member_ids) = 2
            and handover_note = 'Kundin Musterfrau ruft wegen Therme an'))) <> 2 then
    raise exception 'the history does not keep the version before the change';
  end if;
end;
$$;

-- A handover ends the running shift now and starts the next in one call.
do $$
declare
  v_lena uuid := pg_temp.record_of('46900000-0000-4000-8000-000000000004');
  v_result jsonb;
begin
  perform pg_temp.expect_refusal('handing over a shift that has not started',
    format('select public.hand_over_on_call_shift(%L, %L, %L, 1, gen_random_uuid(), now() + interval ''6 days'', null, '''', %L, true)',
      '46900000-0000-4000-8000-000000000002', '46900000-0000-4000-8000-0000000000a0',
      '46900000-0000-4000-8000-000000000102', array[v_lena]),
    'on_call_shift_not_running');
  perform pg_temp.expect_refusal('a handover whose next shift refuses',
    format('select public.hand_over_on_call_shift(%L, %L, %L, 2, gen_random_uuid(), now() + interval ''1 day'', ''Heizung'', '''', ''{}'', true)',
      '46900000-0000-4000-8000-000000000002', '46900000-0000-4000-8000-0000000000a0',
      '46900000-0000-4000-8000-000000000101'),
    'on_call_member_required');
  if (select ends_at <= now() or version <> 2 from public.on_call_shifts
      where id = '46900000-0000-4000-8000-000000000101') then
    raise exception 'a refused handover ended the running shift';
  end if;

  v_result := public.hand_over_on_call_shift('46900000-0000-4000-8000-000000000001',
    '46900000-0000-4000-8000-0000000000a0', '46900000-0000-4000-8000-000000000101', 2,
    '46900000-0000-4000-8000-000000000105', now() + interval '1 day', 'Heizung',
    'Therme Lindenstraße 4 beobachten', array[v_lena], true);
  if v_result ->> 'shiftId' is distinct from '46900000-0000-4000-8000-000000000105' then
    raise exception 'the handover does not answer the next shift';
  end if;
  if not exists (select 1 from public.on_call_shifts
      where id = '46900000-0000-4000-8000-000000000101' and ends_at = now() and version = 3)
    or not exists (select 1 from public.on_call_shifts
      where id = '46900000-0000-4000-8000-000000000105' and starts_at = now()
        and handover_note = 'Therme Lindenstraße 4 beobachten' and label = 'Heizung')
    or not exists (select 1 from public.on_call_shift_members
      where shift_id = '46900000-0000-4000-8000-000000000105' and employee_record_id = v_lena)
  then
    raise exception 'the handover did not end the shift now and start the next';
  end if;
  if (select count(*) from public.on_call_shift_events
      where organization_id = '46900000-0000-4000-8000-0000000000a0'
        and ((shift_id = '46900000-0000-4000-8000-000000000101' and kind = 'handed_over' and version = 3)
          or (shift_id = '46900000-0000-4000-8000-000000000105' and kind = 'taken_over' and version = 1))) <> 2 then
    raise exception 'the handover wrote no history for both shifts';
  end if;
  -- The shift a handover started keeps its exact start through a note-only change.
  perform public.change_on_call_shift('46900000-0000-4000-8000-000000000002',
    '46900000-0000-4000-8000-0000000000a0', '46900000-0000-4000-8000-000000000105', 1,
    (select starts_at from public.on_call_shifts where id = '46900000-0000-4000-8000-000000000105'),
    now() + interval '1 day', 'Heizung', 'Therme Lindenstraße 4 und 6 beobachten', array[v_lena], true);
  perform pg_temp.expect_refusal('changing an ended shift',
    format('select public.end_on_call_shift(%L, %L, %L, 3)',
      '46900000-0000-4000-8000-000000000002', '46900000-0000-4000-8000-0000000000a0',
      '46900000-0000-4000-8000-000000000101'),
    'on_call_shift_over');

  -- Ending a shift that has not started cancels it; one that runs ends now.
  perform public.end_on_call_shift('46900000-0000-4000-8000-000000000002',
    '46900000-0000-4000-8000-0000000000a0', '46900000-0000-4000-8000-000000000102', 1);
  perform public.end_on_call_shift('46900000-0000-4000-8000-000000000002',
    '46900000-0000-4000-8000-0000000000a0', '46900000-0000-4000-8000-000000000104', 1);
  if not exists (select 1 from public.on_call_shifts
      where id = '46900000-0000-4000-8000-000000000102' and cancelled_at = now())
    or not exists (select 1 from public.on_call_shifts
      where id = '46900000-0000-4000-8000-000000000104' and ends_at = now() and cancelled_at is null)
  then
    raise exception 'ending did not cancel the planned shift and end the running one';
  end if;
  perform pg_temp.expect_refusal('changing the history',
    format('update public.on_call_shift_events set handover_note = '''' where shift_id = %L',
      '46900000-0000-4000-8000-000000000101'),
    'event_ledger_history_immutable');
end;
$$;

-- A person who left is never newly named, even on a shift that started before
-- their exit; a changed personnel phone touches their coming shift, which is
-- the Realtime signal every member receives.
do $$
declare
  v_max uuid := pg_temp.record_of('46900000-0000-4000-8000-000000000003');
  v_lena uuid := pg_temp.record_of('46900000-0000-4000-8000-000000000004');
  v_touched timestamptz;
begin
  update public.employee_records set entry_date = (now() at time zone 'Europe/Berlin')::date - 30,
    exit_date = (now() at time zone 'Europe/Berlin')::date - 1
  where id = v_max;
  perform pg_temp.expect_refusal('naming a person who left on a backdated shift',
    format('select pg_temp.plan(gen_random_uuid(), now() - interval ''3 days'', now() + interval ''1 day'', ''Lüftung'', %L)',
      array[v_max]),
    'on_call_member_invalid');
  update public.employee_records set exit_date = null where id = v_max;

  -- The stamp trigger would set now(); off for the seed only, inside this transaction.
  alter table public.on_call_shifts disable trigger on_call_shifts_updated_at;
  update public.on_call_shifts set updated_at = now() - interval '1 hour'
  where id = '46900000-0000-4000-8000-000000000105';
  alter table public.on_call_shifts enable trigger on_call_shifts_updated_at;
  update public.employee_records set phone = '+49 30 1234567' where id = v_lena;
  select updated_at into strict v_touched from public.on_call_shifts
  where id = '46900000-0000-4000-8000-000000000105';
  if v_touched is distinct from now() then
    raise exception 'a changed phone did not touch the coming shift of the person';
  end if;
  if (select count(*) from public.on_call_shift_events
      where shift_id = '46900000-0000-4000-8000-000000000105'
        and organization_id = '46900000-0000-4000-8000-0000000000a0') <> 2 then
    raise exception 'the touch wrote history';
  end if;
end;
$$;

-- The office read carries history and people; the field read neither.
do $$
declare
  v_office jsonb := public.read_on_call_shifts('46900000-0000-4000-8000-0000000000a0',
    now() - interval '1 day', now() + interval '7 days', true);
  v_field jsonb := public.read_on_call_shifts('46900000-0000-4000-8000-0000000000a0',
    now() - interval '1 day', now() + interval '7 days', false);
begin
  if jsonb_array_length(v_office -> 'shifts') is distinct from 5
    or jsonb_array_length(v_field -> 'shifts') is distinct from 4
    or jsonb_array_length(v_office -> 'people') is distinct from 4
    or v_field -> 'people' is distinct from '[]'::jsonb
    or exists (select 1 from jsonb_array_elements(v_field -> 'shifts') shift
      where shift -> 'history' is distinct from '[]'::jsonb)
  then
    raise exception 'the read does not keep the history and the people with the office';
  end if;
end;
$$;

-- No browser role writes a shift or reads the history.
do $$
begin
  if has_table_privilege('anon', 'public.on_call_shifts', 'select')
    or has_table_privilege('anon', 'public.on_call_shift_members', 'select')
    or has_table_privilege('authenticated', 'public.on_call_shifts', 'insert')
    or has_table_privilege('authenticated', 'public.on_call_shifts', 'update')
    or has_table_privilege('authenticated', 'public.on_call_shift_members', 'insert')
    or has_table_privilege('authenticated', 'public.on_call_shift_members', 'delete')
    or has_table_privilege('authenticated', 'public.on_call_shift_events', 'select')
    or has_column_privilege('authenticated', 'public.on_call_shifts', 'created_by', 'select')
    or has_column_privilege('authenticated', 'public.on_call_shifts', 'updated_by', 'select')
    or has_function_privilege('authenticated',
      'public.plan_on_call_shift(uuid, uuid, uuid, timestamptz, timestamptz, text, text, uuid[], boolean)', 'execute')
    or has_function_privilege('authenticated',
      'public.read_on_call_shifts(uuid, timestamptz, timestamptz, boolean)', 'execute')
  then raise exception 'a browser role holds a write or history privilege on the shifts'; end if;
end;
$$;

-- An employee reads the shifts and people of their organization and writes none.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"46900000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.on_call_shifts) <> 5
    or (select count(*) from public.on_call_shift_members) <> 6 then
    raise exception 'an employee does not read the shifts of their organization';
  end if;
end;
$$;
do $$
begin
  begin
    update public.on_call_shifts set handover_note = 'x';
  exception when insufficient_privilege then
    begin
      insert into public.on_call_shift_members (shift_id, organization_id, employee_record_id)
      select shift_id, organization_id, employee_record_id from public.on_call_shift_members limit 1;
    exception when insufficient_privilege then
      return;
    end;
    raise exception 'an employee added a person to a shift';
  end;
  raise exception 'an employee updated a shift';
end;
$$;
-- A member of another organization reads nothing.
select set_config('request.jwt.claims', '{"sub":"46900000-0000-4000-8000-000000000006","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.on_call_shifts) or exists (select 1 from public.on_call_shift_members) then
    raise exception 'a foreign organization reads shifts';
  end if;
end;
$$;
reset role;

rollback;
