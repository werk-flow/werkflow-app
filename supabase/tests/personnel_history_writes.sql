-- Creating a personnel record, editing its master data and adding, correcting
-- or deleting an employment condition or a work schedule store the change and
-- its employee record history row in one call or nothing, and refuse with the
-- action's failure codes (migration
-- 20261004190100_write_personnel_history_with_its_change.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('c3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'personnel-history-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Personal"}', now(), now()),
('c3000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'personnel-history-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Personal"}', now(), now()),
('c3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'personnel-history-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Personal"}', now(), now()),
('c3000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'personnel-history-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Personal"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('c3000000-0000-4000-8000-000000000010', 'Personnel history SQL',
 'c3000000-0000-4000-8000-000000000001', 'PERSHIST'),
('c3000000-0000-4000-8000-000000000011', 'Personnel history SQL other',
 'c3000000-0000-4000-8000-000000000004', 'PERSHISTO');
insert into public.organization_members (organization_id, user_id, role) values
('c3000000-0000-4000-8000-000000000010', 'c3000000-0000-4000-8000-000000000002', 'buero'),
('c3000000-0000-4000-8000-000000000010', 'c3000000-0000-4000-8000-000000000003', 'employee');

-- A membership brings its linked personnel record; the field worker's is the
-- linked record of these tests.
insert into public.employee_records (id, organization_id, employee_number, first_name, last_name, entry_date) values
('c3000000-0000-4000-8000-000000000020', 'c3000000-0000-4000-8000-000000000010', 'MA-901', 'Erika', 'Muster', '2026-01-01'),
('c3000000-0000-4000-8000-000000000029', 'c3000000-0000-4000-8000-000000000011', 'MA-901', 'Fremd', 'Person', null);
create temporary table linked_record as
select record.id, record.last_name from public.employee_records record
where record.organization_id = 'c3000000-0000-4000-8000-000000000010'
  and record.user_id = 'c3000000-0000-4000-8000-000000000003';
grant select on linked_record to service_role;

insert into public.employment_conditions (
  id, organization_id, employee_record_id, valid_from, employment_type, weekly_hours, vacation_days_per_year
) values
('c3000000-0000-4000-8000-000000000030', 'c3000000-0000-4000-8000-000000000010',
 'c3000000-0000-4000-8000-000000000020', '2026-01-01', 'vollzeit', 40, 30),
('c3000000-0000-4000-8000-000000000031', 'c3000000-0000-4000-8000-000000000010',
 'c3000000-0000-4000-8000-000000000020', '2026-07-01', 'teilzeit', 20, 15),
('c3000000-0000-4000-8000-000000000039', 'c3000000-0000-4000-8000-000000000011',
 'c3000000-0000-4000-8000-000000000029', '2026-01-01', 'vollzeit', 40, 30);

insert into public.work_schedules (
  id, organization_id, employee_record_id, valid_from, monday_minutes, tuesday_minutes,
  wednesday_minutes, thursday_minutes, friday_minutes
) values
('c3000000-0000-4000-8000-000000000040', 'c3000000-0000-4000-8000-000000000010',
 'c3000000-0000-4000-8000-000000000020', '2026-01-01', 480, 480, 480, 480, 480),
('c3000000-0000-4000-8000-000000000041', 'c3000000-0000-4000-8000-000000000010',
 'c3000000-0000-4000-8000-000000000020', '2026-07-01', 240, 240, 240, 240, 240),
('c3000000-0000-4000-8000-000000000049', 'c3000000-0000-4000-8000-000000000011',
 'c3000000-0000-4000-8000-000000000029', '2026-01-01', 480, 480, 480, 480, 480);

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
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
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- Both organizations' personnel rows and history as one comparable value.
create function pg_temp.personnel_state() returns text language sql as $$
  select concat_ws('#',
    (select string_agg(to_jsonb(record)::text, '|' order by record.id) from public.employee_records record
      where record.organization_id in ('c3000000-0000-4000-8000-000000000010', 'c3000000-0000-4000-8000-000000000011')),
    (select string_agg(to_jsonb(condition)::text, '|' order by condition.id) from public.employment_conditions condition
      where condition.organization_id in ('c3000000-0000-4000-8000-000000000010', 'c3000000-0000-4000-8000-000000000011')),
    (select string_agg(to_jsonb(schedule)::text, '|' order by schedule.id) from public.work_schedules schedule
      where schedule.organization_id in ('c3000000-0000-4000-8000-000000000010', 'c3000000-0000-4000-8000-000000000011')),
    (select count(*)::text from public.employee_record_events event
      where event.organization_id in ('c3000000-0000-4000-8000-000000000010', 'c3000000-0000-4000-8000-000000000011'))
  );
$$;

create temporary table personnel_state_before as select pg_temp.personnel_state() as state;

-- Every refusal keeps its code and changes nothing.
set local role service_role;

select pg_temp.expect_refusal('record created by a field worker', $sql$
  select public.create_employee_record('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000010',
    'Max', 'Neu', null, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('record created by an outsider', $sql$
  select public.create_employee_record('c3000000-0000-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000010',
    'Max', 'Neu', null, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('record without a last name', $sql$
  select public.create_employee_record('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'Max', ' ', null, null, null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('record with a taken number', $sql$
  select public.create_employee_record('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'Max', 'Neu', 'MA-901', null, null)
$sql$, 'number_taken');

select pg_temp.expect_refusal('master data of a record of another organization', $sql$
  select public.update_employee_master_data('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000029', '{"phone": "0711"}')
$sql$, 'record_not_found');
select pg_temp.expect_refusal('master data edited by a field worker', $sql$
  select public.update_employee_master_data('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '{"phone": "0711"}')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('master data with an unknown field', $sql$
  select public.update_employee_master_data('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '{"user_id": "c3000000-0000-4000-8000-000000000004"}')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('name of a linked record', $sql$
  select public.update_employee_master_data('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    (select id from linked_record), '{"last_name": "Anders"}')
$sql$, 'name_managed_by_profile');
select pg_temp.expect_refusal('master data with a taken number', $sql$
  select public.update_employee_master_data('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    (select id from linked_record), '{"employee_number": "MA-901"}')
$sql$, 'number_taken');
select pg_temp.expect_refusal('exit before the entry', $sql$
  select public.update_employee_master_data('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '{"exit_date": "2025-12-31"}')
$sql$, 'exit_before_entry');

select pg_temp.expect_refusal('condition of a record of another organization', $sql$
  select public.add_employment_condition('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000029', '2027-01-01', 'vollzeit', 40, 30, null)
$sql$, 'record_not_found');
select pg_temp.expect_refusal('condition added by a field worker', $sql$
  select public.add_employment_condition('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '2027-01-01', 'vollzeit', 40, 30, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('second condition on the same date', $sql$
  select public.add_employment_condition('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '2026-01-01', 'vollzeit', 40, 30, null)
$sql$, 'duplicate_valid_from');
select pg_temp.expect_refusal('correction of a condition of another organization', $sql$
  select public.update_employment_condition('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000039', '2026-02-01', 'vollzeit', 40, 30, null)
$sql$, 'condition_not_found');
select pg_temp.expect_refusal('correction of a condition by a field worker', $sql$
  select public.update_employment_condition('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000030', '2026-02-01', 'vollzeit', 40, 30, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('correction of a condition onto a taken date', $sql$
  select public.update_employment_condition('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000030', '2026-07-01', 'vollzeit', 40, 30, null)
$sql$, 'duplicate_valid_from');
select pg_temp.expect_refusal('deleting a condition of another organization', $sql$
  select public.delete_employment_condition('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000039')
$sql$, 'condition_not_found');
select pg_temp.expect_refusal('deleting a condition by a field worker', $sql$
  select public.delete_employment_condition('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000030')
$sql$, 'not_authorized');

select pg_temp.expect_refusal('schedule of a record of another organization', $sql$
  select public.add_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000029', '2027-01-01', array[480, 480, 480, 480, 480, 0, 0], null)
$sql$, 'record_not_found');
select pg_temp.expect_refusal('schedule added by a field worker', $sql$
  select public.add_work_schedule('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '2027-01-01', array[480, 480, 480, 480, 480, 0, 0], null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('schedule with six days', $sql$
  select public.add_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '2027-01-01', array[480, 480, 480, 480, 480, 0], null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('second schedule on the same date', $sql$
  select public.add_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '2026-01-01', array[480, 480, 480, 480, 480, 0, 0], null)
$sql$, 'duplicate_valid_from');
select pg_temp.expect_refusal('correction of a schedule of another organization', $sql$
  select public.update_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000049', '2026-02-01', array[480, 480, 480, 480, 480, 0, 0], null)
$sql$, 'schedule_not_found');
select pg_temp.expect_refusal('correction of a schedule onto a taken date', $sql$
  select public.update_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000040', '2026-07-01', array[480, 480, 480, 480, 480, 0, 0], null)
$sql$, 'duplicate_valid_from');
select pg_temp.expect_refusal('deleting a schedule of another organization', $sql$
  select public.delete_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000049')
$sql$, 'schedule_not_found');
select pg_temp.expect_refusal('deleting a schedule by a field worker', $sql$
  select public.delete_work_schedule('c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000040')
$sql$, 'not_authorized');

reset role;

-- The history row is the last step. When it is refused, the change is rolled
-- back with it: nothing changes without its history row.
create function pg_temp.refuse_history() returns trigger language plpgsql as $$
begin
  raise exception 'history refused';
end;
$$;
create trigger refuse_employee_record_event before insert on public.employee_record_events
  for each row execute function pg_temp.refuse_history();

set local role service_role;
select pg_temp.expect_refusal('record whose history row is refused', $sql$
  select public.create_employee_record('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'Max', 'Neu', 'MA-003', '2026-03-01', null)
$sql$, 'history refused');
select pg_temp.expect_refusal('master data whose history row is refused', $sql$
  select public.update_employee_master_data('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '{"phone": "0711", "city": "Stuttgart"}')
$sql$, 'history refused');
select pg_temp.expect_refusal('condition whose history row is refused', $sql$
  select public.add_employment_condition('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '2027-01-01', 'vollzeit', 40, 30, null)
$sql$, 'history refused');
select pg_temp.expect_refusal('condition correction whose history row is refused', $sql$
  select public.update_employment_condition('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000030', '2026-02-01', 'teilzeit', 30, 25, 'Neu')
$sql$, 'history refused');
select pg_temp.expect_refusal('condition deletion whose history row is refused', $sql$
  select public.delete_employment_condition('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000031')
$sql$, 'history refused');
select pg_temp.expect_refusal('schedule whose history row is refused', $sql$
  select public.add_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000020', '2027-01-01', array[480, 480, 480, 480, 480, 0, 0], null)
$sql$, 'history refused');
select pg_temp.expect_refusal('schedule correction whose history row is refused', $sql$
  select public.update_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000040', '2026-02-01', array[420, 420, 420, 420, 420, 0, 0], 'Neu')
$sql$, 'history refused');
select pg_temp.expect_refusal('schedule deletion whose history row is refused', $sql$
  select public.delete_work_schedule('c3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000010',
    'c3000000-0000-4000-8000-000000000041')
$sql$, 'history refused');
reset role;

drop trigger refuse_employee_record_event on public.employee_record_events;

do $$
begin
  if pg_temp.personnel_state() <> (select state from personnel_state_before) then
    raise exception 'a refused personnel write changed rows or history';
  end if;
end;
$$;

-- Each clean write stores the change and exactly its history row.
set local role service_role;

do $$
declare
  v_org constant uuid := 'c3000000-0000-4000-8000-000000000010';
  v_actor constant uuid := 'c3000000-0000-4000-8000-000000000002';
  v_record constant uuid := 'c3000000-0000-4000-8000-000000000020';
  v_linked constant uuid := (select id from linked_record);
  v_new_id uuid;
  v_events_before bigint;
  v_payload jsonb;
  v_row public.employee_records;
begin
  -- Creating a record.
  v_new_id := public.create_employee_record(v_actor, v_org, 'Max', 'Neu', 'MA-003', '2026-03-01', 'Neu im Team');
  select * into v_row from public.employee_records where id = v_new_id;
  if v_row.organization_id <> v_org or v_row.last_name <> 'Neu' or v_row.employee_number <> 'MA-003'
    or v_row.entry_date <> '2026-03-01' or v_row.created_by <> v_actor or v_row.user_id is not null
  then raise exception 'creating a record stored the wrong row: %', to_jsonb(v_row); end if;
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_new_id and event_type = 'created' and created_by = v_actor;
  if v_payload is distinct from jsonb_build_object('employee_number', 'MA-003', 'first_name', 'Max',
    'last_name', 'Neu', 'entry_date', '2026-03-01', 'notes', 'Neu im Team')
  then raise exception 'creating a record recorded the wrong history: %', v_payload; end if;

  -- Editing master data records only the fields that differ; an unchanged
  -- name of a linked record passes, and a patch without a change writes nothing.
  perform public.update_employee_master_data(v_actor, v_org, v_record,
    '{"phone": "0711", "city": "Stuttgart", "first_name": "Erika", "exit_date": "2026-12-31"}');
  select * into v_row from public.employee_records where id = v_record;
  if v_row.phone <> '0711' or v_row.city <> 'Stuttgart' or v_row.exit_date <> '2026-12-31' then
    raise exception 'editing master data stored the wrong row: %', to_jsonb(v_row);
  end if;
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_record and event_type = 'master_data_updated' and created_by = v_actor;
  if v_payload is distinct from '{"changes": {"city": {"from": null, "to": "Stuttgart"},
    "phone": {"from": null, "to": "0711"}, "exit_date": {"from": null, "to": "2026-12-31"}}}'::jsonb
  then raise exception 'editing master data recorded the wrong history: %', v_payload; end if;
  select count(*) into v_events_before from public.employee_record_events where employee_record_id in (v_record, v_linked);
  perform public.update_employee_master_data(v_actor, v_org, v_record, '{"phone": "0711"}');
  perform public.update_employee_master_data(v_actor, v_org, v_linked,
    jsonb_build_object('last_name', (select last_name from linked_record)));
  if (select count(*) from public.employee_record_events where employee_record_id in (v_record, v_linked))
    <> v_events_before
  then raise exception 'a patch without a change recorded history'; end if;

  -- Conditions: add, correct, delete.
  v_new_id := public.add_employment_condition(v_actor, v_org, v_record, '2027-01-01', 'teilzeit', 37.5, 28, 'Neu');
  if not exists (select 1 from public.employment_conditions where id = v_new_id and employee_record_id = v_record
    and employment_type = 'teilzeit' and weekly_hours = 37.5 and created_by = v_actor)
  then raise exception 'adding a condition stored the wrong row'; end if;
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_record and event_type = 'condition_added';
  if v_payload is distinct from jsonb_build_object('condition_id', v_new_id, 'valid_from', '2027-01-01',
    'employment_type', 'teilzeit', 'weekly_hours', 37.5, 'vacation_days_per_year', 28, 'note', 'Neu')
  then raise exception 'adding a condition recorded the wrong history: %', v_payload; end if;

  perform public.update_employment_condition(v_actor, v_org, 'c3000000-0000-4000-8000-000000000030',
    '2026-02-01', 'teilzeit', 30, 25, 'Korrektur');
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_record and event_type = 'condition_updated';
  if v_payload -> 'before' ->> 'valid_from' <> '2026-01-01' or (v_payload -> 'before' ->> 'weekly_hours')::numeric <> 40
    or v_payload -> 'after' is distinct from jsonb_build_object('valid_from', '2026-02-01',
      'employment_type', 'teilzeit', 'weekly_hours', 30, 'vacation_days_per_year', 25, 'note', 'Korrektur')
  then raise exception 'correcting a condition recorded the wrong history: %', v_payload; end if;

  perform public.delete_employment_condition(v_actor, v_org, 'c3000000-0000-4000-8000-000000000031');
  if exists (select 1 from public.employment_conditions where id = 'c3000000-0000-4000-8000-000000000031') then
    raise exception 'deleting a condition kept the row';
  end if;
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_record and event_type = 'condition_deleted';
  if v_payload ->> 'condition_id' <> 'c3000000-0000-4000-8000-000000000031'
    or v_payload -> 'deleted' ->> 'employment_type' <> 'teilzeit'
  then raise exception 'deleting a condition recorded the wrong history: %', v_payload; end if;

  -- Schedules: add, correct, delete.
  v_new_id := public.add_work_schedule(v_actor, v_org, v_record, '2027-01-01', array[300, 300, 300, 300, 300, 60, 0], 'Neu');
  if not exists (select 1 from public.work_schedules where id = v_new_id and monday_minutes = 300
    and saturday_minutes = 60 and sunday_minutes = 0 and created_by = v_actor)
  then raise exception 'adding a schedule stored the wrong row'; end if;
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_record and event_type = 'schedule_added';
  if v_payload is distinct from jsonb_build_object('schedule_id', v_new_id, 'valid_from', '2027-01-01',
    'day_minutes', jsonb_build_array(300, 300, 300, 300, 300, 60, 0), 'weekly_minutes', 1560, 'note', 'Neu')
  then raise exception 'adding a schedule recorded the wrong history: %', v_payload; end if;

  perform public.update_work_schedule(v_actor, v_org, 'c3000000-0000-4000-8000-000000000040',
    '2026-02-01', array[420, 420, 420, 420, 420, 0, 0], 'Korrektur');
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_record and event_type = 'schedule_updated';
  if v_payload -> 'before' is distinct from jsonb_build_object('valid_from', '2026-01-01',
      'day_minutes', jsonb_build_array(480, 480, 480, 480, 480, 0, 0), 'weekly_minutes', 2400, 'note', null)
    or v_payload -> 'after' ->> 'weekly_minutes' <> '2100'
  then raise exception 'correcting a schedule recorded the wrong history: %', v_payload; end if;

  perform public.delete_work_schedule(v_actor, v_org, 'c3000000-0000-4000-8000-000000000041');
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_record and event_type = 'schedule_deleted';
  if exists (select 1 from public.work_schedules where id = 'c3000000-0000-4000-8000-000000000041')
    or v_payload -> 'deleted' ->> 'weekly_minutes' <> '1200'
  then raise exception 'deleting a schedule recorded the wrong history: %', v_payload; end if;
end;
$$;

reset role;

do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.create_employee_record(uuid, uuid, text, text, text, date, text)',
    'public.update_employee_master_data(uuid, uuid, uuid, jsonb)',
    'public.add_employment_condition(uuid, uuid, uuid, date, text, numeric, numeric, text)',
    'public.update_employment_condition(uuid, uuid, uuid, date, text, numeric, numeric, text)',
    'public.delete_employment_condition(uuid, uuid, uuid)',
    'public.add_work_schedule(uuid, uuid, uuid, date, integer[], text)',
    'public.update_work_schedule(uuid, uuid, uuid, date, integer[], text)',
    'public.delete_work_schedule(uuid, uuid, uuid)'
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
  foreach v_function in array array[
    'app_private.work_schedule_audit_payload(date, integer[], text)',
    'app_private.work_schedule_day_minutes(public.work_schedules)'
  ] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
end;
$$;

rollback;
