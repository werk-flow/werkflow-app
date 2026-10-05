-- Creating a personnel record, editing its master data and adding, correcting
-- or deleting an employment condition or a work schedule write the change and
-- its employee record history row together or not at all. The server actions
-- in lib/personnel/actions.ts wrote employee_records, employment_conditions or
-- work_schedules first and then inserted the employee_record_events row through
-- recordEmployeeRecordEvent, whose failure was only logged, so a change could
-- land without its history row. The record, condition and schedule pre-checks
-- were separate reads before the write, so the 'before' values of a correction
-- and the master data changes were computed from rows read before the write.
--
-- Division of work: the action establishes identity, the active membership,
-- the role and the organization, validates and normalizes the input and passes
-- server-resolved values. Each function locks the row it changes or depends on
-- and the actor's membership (app_private.lock_qualification_actor, the shared
-- membership lock of migration 20261004180000), repeats the state checks under
-- those locks and raises the action failure code of the first refusal, so
-- nothing changes. The unique index employee_records_org_number_unique decides
-- a taken personnel number, the constraint employee_records_exit_after_entry an
-- exit before the entry, and the unique constraints
-- employment_conditions_record_valid_from_unique and
-- work_schedules_unique_valid_from a second version on the same date.
--
-- Signals stay as before: the writes to employee_records, employment_conditions
-- and work_schedules reach their Realtime publication; employee_record_events
-- stays unpublished.

-- The history payload of one schedule version, as the record history shows it.
create function app_private.work_schedule_audit_payload(
  p_valid_from date,
  p_day_minutes integer[],
  p_note text
)
returns jsonb
language sql
immutable
set search_path to ''
as $$
  select jsonb_build_object(
    'valid_from', p_valid_from,
    'day_minutes', to_jsonb(p_day_minutes),
    'weekly_minutes', (select coalesce(sum(minutes), 0) from unnest(p_day_minutes) as minutes),
    'note', p_note
  );
$$;

-- The seven weekday minutes of a stored schedule, Monday first.
create function app_private.work_schedule_day_minutes(p_schedule public.work_schedules)
returns integer[]
language sql
immutable
set search_path to ''
as $$
  select array[
    p_schedule.monday_minutes, p_schedule.tuesday_minutes, p_schedule.wednesday_minutes,
    p_schedule.thursday_minutes, p_schedule.friday_minutes, p_schedule.saturday_minutes,
    p_schedule.sunday_minutes
  ];
$$;

-- Creates a personnel record without login and records 'created' with its
-- values. Refusals: invalid_input, not_authorized, number_taken. Returns the
-- record id.
create function public.create_employee_record(
  p_actor_id uuid,
  p_organization_id uuid,
  p_first_name text,
  p_last_name text,
  p_employee_number text,
  p_entry_date date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_record_id uuid;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or coalesce(btrim(p_last_name), '') = '' then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  begin
    insert into public.employee_records (
      organization_id, first_name, last_name, employee_number, entry_date, notes, created_by
    ) values (
      p_organization_id, p_first_name, p_last_name, p_employee_number, p_entry_date, p_notes, p_actor_id
    )
    returning id into v_record_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'employee_records_org_number_unique' then raise exception 'number_taken'; end if;
    raise;
  end;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_record_id, 'created',
    jsonb_build_object(
      'employee_number', p_employee_number, 'first_name', p_first_name, 'last_name', p_last_name,
      'entry_date', p_entry_date, 'notes', p_notes
    ),
    p_actor_id
  );

  return v_record_id;
end;
$$;

-- Applies the master data patch, an object of column names and their new text
-- values, to the fields whose value differs under the lock, and records
-- 'master_data_updated' with each changed field's value before and after. A
-- patch that changes nothing writes nothing. A linked record's name belongs
-- to the profile. Refusals: invalid_input, record_not_found, not_authorized,
-- name_managed_by_profile, number_taken, exit_before_entry.
create function public.update_employee_master_data(
  p_actor_id uuid,
  p_organization_id uuid,
  p_record_id uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.employee_records;
  v_changes jsonb;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_record_id is null
    or jsonb_typeof(p_patch) is distinct from 'object'
    or exists (
      select 1 from jsonb_each(p_patch) as field
      where field.key not in (
          'employee_number', 'first_name', 'last_name', 'phone', 'private_email', 'street',
          'postal_code', 'city', 'emergency_contact_name', 'emergency_contact_phone',
          'entry_date', 'exit_date', 'notes'
        )
        or jsonb_typeof(field.value) not in ('string', 'null')
    )
  then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.employee_records record
  where record.organization_id = p_organization_id and record.id = p_record_id
  for no key update;
  if not found then raise exception 'record_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  select coalesce(jsonb_object_agg(field.key, jsonb_build_object('from', to_jsonb(v_previous) -> field.key, 'to', field.value)), '{}'::jsonb)
  into v_changes
  from jsonb_each(p_patch) as field
  where (to_jsonb(v_previous) -> field.key) is distinct from field.value;

  if v_changes = '{}'::jsonb then return; end if;
  if v_previous.user_id is not null and (v_changes ? 'first_name' or v_changes ? 'last_name') then
    raise exception 'name_managed_by_profile';
  end if;

  begin
    update public.employee_records record
    set employee_number = case when v_changes ? 'employee_number' then v_changes -> 'employee_number' ->> 'to' else record.employee_number end,
        first_name = case when v_changes ? 'first_name' then v_changes -> 'first_name' ->> 'to' else record.first_name end,
        last_name = case when v_changes ? 'last_name' then v_changes -> 'last_name' ->> 'to' else record.last_name end,
        phone = case when v_changes ? 'phone' then v_changes -> 'phone' ->> 'to' else record.phone end,
        private_email = case when v_changes ? 'private_email' then v_changes -> 'private_email' ->> 'to' else record.private_email end,
        street = case when v_changes ? 'street' then v_changes -> 'street' ->> 'to' else record.street end,
        postal_code = case when v_changes ? 'postal_code' then v_changes -> 'postal_code' ->> 'to' else record.postal_code end,
        city = case when v_changes ? 'city' then v_changes -> 'city' ->> 'to' else record.city end,
        emergency_contact_name = case when v_changes ? 'emergency_contact_name'
          then v_changes -> 'emergency_contact_name' ->> 'to' else record.emergency_contact_name end,
        emergency_contact_phone = case when v_changes ? 'emergency_contact_phone'
          then v_changes -> 'emergency_contact_phone' ->> 'to' else record.emergency_contact_phone end,
        entry_date = case when v_changes ? 'entry_date' then (v_changes -> 'entry_date' ->> 'to')::date else record.entry_date end,
        exit_date = case when v_changes ? 'exit_date' then (v_changes -> 'exit_date' ->> 'to')::date else record.exit_date end,
        notes = case when v_changes ? 'notes' then v_changes -> 'notes' ->> 'to' else record.notes end
    where record.organization_id = p_organization_id and record.id = p_record_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'employee_records_org_number_unique' then raise exception 'number_taken'; end if;
      raise;
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'employee_records_exit_after_entry' then raise exception 'exit_before_entry'; end if;
      raise;
  end;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_record_id, 'master_data_updated', jsonb_build_object('changes', v_changes), p_actor_id
  );
end;
$$;

-- Adds a date-effective employment condition to a record and records
-- 'condition_added'. Refusals: invalid_input, record_not_found,
-- not_authorized, duplicate_valid_from. Returns the condition id.
create function public.add_employment_condition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_record_id uuid,
  p_valid_from date,
  p_employment_type text,
  p_weekly_hours numeric,
  p_vacation_days_per_year numeric,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_condition_id uuid;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_record_id is null
    or p_valid_from is null or p_employment_type is null
  then
    raise exception 'invalid_input';
  end if;

  perform 1 from public.employee_records record
  where record.organization_id = p_organization_id and record.id = p_record_id
  for key share;
  if not found then raise exception 'record_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  begin
    insert into public.employment_conditions (
      organization_id, employee_record_id, valid_from, employment_type, weekly_hours,
      vacation_days_per_year, note, created_by
    ) values (
      p_organization_id, p_record_id, p_valid_from, p_employment_type, p_weekly_hours,
      p_vacation_days_per_year, p_note, p_actor_id
    )
    returning id into v_condition_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'employment_conditions_record_valid_from_unique' then
      raise exception 'duplicate_valid_from';
    end if;
    raise;
  end;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_record_id, 'condition_added',
    jsonb_build_object(
      'condition_id', v_condition_id, 'valid_from', p_valid_from, 'employment_type', p_employment_type,
      'weekly_hours', p_weekly_hours, 'vacation_days_per_year', p_vacation_days_per_year, 'note', p_note
    ),
    p_actor_id
  );

  return v_condition_id;
end;
$$;

-- Corrects an employment condition and records 'condition_updated' with the
-- values before and after, read under the lock. Refusals: invalid_input,
-- condition_not_found, not_authorized, duplicate_valid_from.
create function public.update_employment_condition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_condition_id uuid,
  p_valid_from date,
  p_employment_type text,
  p_weekly_hours numeric,
  p_vacation_days_per_year numeric,
  p_note text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.employment_conditions;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_condition_id is null
    or p_valid_from is null or p_employment_type is null
  then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.employment_conditions condition
  where condition.organization_id = p_organization_id and condition.id = p_condition_id
  for no key update;
  if not found then raise exception 'condition_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  begin
    update public.employment_conditions condition
    set valid_from = p_valid_from, employment_type = p_employment_type, weekly_hours = p_weekly_hours,
        vacation_days_per_year = p_vacation_days_per_year, note = p_note
    where condition.organization_id = p_organization_id and condition.id = p_condition_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'employment_conditions_record_valid_from_unique' then
      raise exception 'duplicate_valid_from';
    end if;
    raise;
  end;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_previous.employee_record_id, 'condition_updated',
    jsonb_build_object(
      'condition_id', p_condition_id,
      'before', jsonb_build_object(
        'valid_from', v_previous.valid_from, 'employment_type', v_previous.employment_type,
        'weekly_hours', v_previous.weekly_hours, 'vacation_days_per_year', v_previous.vacation_days_per_year,
        'note', v_previous.note
      ),
      'after', jsonb_build_object(
        'valid_from', p_valid_from, 'employment_type', p_employment_type, 'weekly_hours', p_weekly_hours,
        'vacation_days_per_year', p_vacation_days_per_year, 'note', p_note
      )
    ),
    p_actor_id
  );
end;
$$;

-- Deletes an employment condition and records 'condition_deleted' with the
-- deleted values. Refusals: invalid_input, condition_not_found, not_authorized.
create function public.delete_employment_condition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_condition_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.employment_conditions;
begin
  if p_actor_id is null or p_organization_id is null or p_condition_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.employment_conditions condition
  where condition.organization_id = p_organization_id and condition.id = p_condition_id
  for update;
  if not found then raise exception 'condition_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  delete from public.employment_conditions condition
  where condition.organization_id = p_organization_id and condition.id = p_condition_id;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_previous.employee_record_id, 'condition_deleted',
    jsonb_build_object(
      'condition_id', p_condition_id,
      'deleted', jsonb_build_object(
        'valid_from', v_previous.valid_from, 'employment_type', v_previous.employment_type,
        'weekly_hours', v_previous.weekly_hours, 'vacation_days_per_year', v_previous.vacation_days_per_year,
        'note', v_previous.note
      )
    ),
    p_actor_id
  );
end;
$$;

-- Adds a date-effective work schedule (seven weekday minutes, Monday first)
-- to a record and records 'schedule_added'. Refusals: invalid_input,
-- record_not_found, not_authorized, duplicate_valid_from. Returns the schedule id.
create function public.add_work_schedule(
  p_actor_id uuid,
  p_organization_id uuid,
  p_record_id uuid,
  p_valid_from date,
  p_day_minutes integer[],
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_schedule_id uuid;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_record_id is null or p_valid_from is null
    or cardinality(p_day_minutes) is distinct from 7 or array_position(p_day_minutes, null) is not null
  then
    raise exception 'invalid_input';
  end if;

  perform 1 from public.employee_records record
  where record.organization_id = p_organization_id and record.id = p_record_id
  for key share;
  if not found then raise exception 'record_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  begin
    insert into public.work_schedules (
      organization_id, employee_record_id, valid_from, monday_minutes, tuesday_minutes,
      wednesday_minutes, thursday_minutes, friday_minutes, saturday_minutes, sunday_minutes,
      note, created_by
    ) values (
      p_organization_id, p_record_id, p_valid_from, p_day_minutes[1], p_day_minutes[2],
      p_day_minutes[3], p_day_minutes[4], p_day_minutes[5], p_day_minutes[6], p_day_minutes[7],
      p_note, p_actor_id
    )
    returning id into v_schedule_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'work_schedules_unique_valid_from' then raise exception 'duplicate_valid_from'; end if;
    raise;
  end;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_record_id, 'schedule_added',
    jsonb_build_object('schedule_id', v_schedule_id)
      || app_private.work_schedule_audit_payload(p_valid_from, p_day_minutes, p_note),
    p_actor_id
  );

  return v_schedule_id;
end;
$$;

-- Corrects a work schedule and records 'schedule_updated' with the versions
-- before and after, read under the lock. Refusals: invalid_input,
-- schedule_not_found, not_authorized, duplicate_valid_from.
create function public.update_work_schedule(
  p_actor_id uuid,
  p_organization_id uuid,
  p_schedule_id uuid,
  p_valid_from date,
  p_day_minutes integer[],
  p_note text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.work_schedules;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_schedule_id is null or p_valid_from is null
    or cardinality(p_day_minutes) is distinct from 7 or array_position(p_day_minutes, null) is not null
  then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.work_schedules schedule
  where schedule.organization_id = p_organization_id and schedule.id = p_schedule_id
  for no key update;
  if not found then raise exception 'schedule_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  begin
    update public.work_schedules schedule
    set valid_from = p_valid_from,
        monday_minutes = p_day_minutes[1], tuesday_minutes = p_day_minutes[2],
        wednesday_minutes = p_day_minutes[3], thursday_minutes = p_day_minutes[4],
        friday_minutes = p_day_minutes[5], saturday_minutes = p_day_minutes[6],
        sunday_minutes = p_day_minutes[7], note = p_note
    where schedule.organization_id = p_organization_id and schedule.id = p_schedule_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'work_schedules_unique_valid_from' then raise exception 'duplicate_valid_from'; end if;
    raise;
  end;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_previous.employee_record_id, 'schedule_updated',
    jsonb_build_object(
      'schedule_id', p_schedule_id,
      'before', app_private.work_schedule_audit_payload(
        v_previous.valid_from, app_private.work_schedule_day_minutes(v_previous), v_previous.note
      ),
      'after', app_private.work_schedule_audit_payload(p_valid_from, p_day_minutes, p_note)
    ),
    p_actor_id
  );
end;
$$;

-- Deletes a work schedule and records 'schedule_deleted' with the deleted
-- version. Refusals: invalid_input, schedule_not_found, not_authorized.
create function public.delete_work_schedule(
  p_actor_id uuid,
  p_organization_id uuid,
  p_schedule_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.work_schedules;
begin
  if p_actor_id is null or p_organization_id is null or p_schedule_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.work_schedules schedule
  where schedule.organization_id = p_organization_id and schedule.id = p_schedule_id
  for update;
  if not found then raise exception 'schedule_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  delete from public.work_schedules schedule
  where schedule.organization_id = p_organization_id and schedule.id = p_schedule_id;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_previous.employee_record_id, 'schedule_deleted',
    jsonb_build_object(
      'schedule_id', p_schedule_id,
      'deleted', app_private.work_schedule_audit_payload(
        v_previous.valid_from, app_private.work_schedule_day_minutes(v_previous), v_previous.note
      )
    ),
    p_actor_id
  );
end;
$$;

revoke all on function app_private.work_schedule_audit_payload(date, integer[], text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.work_schedule_day_minutes(public.work_schedules)
  from public, anon, authenticated, service_role;
revoke all on function public.create_employee_record(uuid, uuid, text, text, text, date, text)
  from public, anon, authenticated;
revoke all on function public.update_employee_master_data(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.add_employment_condition(uuid, uuid, uuid, date, text, numeric, numeric, text)
  from public, anon, authenticated;
revoke all on function public.update_employment_condition(uuid, uuid, uuid, date, text, numeric, numeric, text)
  from public, anon, authenticated;
revoke all on function public.delete_employment_condition(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.add_work_schedule(uuid, uuid, uuid, date, integer[], text)
  from public, anon, authenticated;
revoke all on function public.update_work_schedule(uuid, uuid, uuid, date, integer[], text)
  from public, anon, authenticated;
revoke all on function public.delete_work_schedule(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_employee_record(uuid, uuid, text, text, text, date, text) to service_role;
grant execute on function public.update_employee_master_data(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.add_employment_condition(uuid, uuid, uuid, date, text, numeric, numeric, text)
  to service_role;
grant execute on function public.update_employment_condition(uuid, uuid, uuid, date, text, numeric, numeric, text)
  to service_role;
grant execute on function public.delete_employment_condition(uuid, uuid, uuid) to service_role;
grant execute on function public.add_work_schedule(uuid, uuid, uuid, date, integer[], text) to service_role;
grant execute on function public.update_work_schedule(uuid, uuid, uuid, date, integer[], text) to service_role;
grant execute on function public.delete_work_schedule(uuid, uuid, uuid) to service_role;
