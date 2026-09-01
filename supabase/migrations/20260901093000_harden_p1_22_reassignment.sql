-- A correction may reassign effective time, but an approver must also hold
-- time_approval scope for every destination person in the applied snapshot.

create or replace function app_private.validate_time_correction_application_targets()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_fact jsonb;
  v_employee_id uuid;
  v_user_id uuid;
  v_actual_user_id uuid;
  v_subject_user_id uuid;
begin
  select subject_user_id into v_subject_user_id
  from public.time_correction_requests
  where id = new.request_id and organization_id = new.organization_id;
  if v_subject_user_id is null then
    raise exception 'time_correction_subject_missing';
  end if;

  for v_fact in select value from jsonb_array_elements(new.applied_snapshot -> 'facts')
  loop
    begin
      v_employee_id := (v_fact ->> 'employeeRecordId')::uuid;
      v_user_id := (v_fact ->> 'userId')::uuid;
    exception when others then
      raise exception 'time_correction_target_invalid';
    end;
    select user_id into v_actual_user_id
    from public.employee_records
    where id = v_employee_id and organization_id = new.organization_id;
    if v_actual_user_id is null or v_actual_user_id <> v_user_id then
      raise exception 'time_correction_target_invalid';
    end if;
    if v_user_id <> v_subject_user_id
      and not app_private.is_time_approval_holder(
        new.organization_id, new.applied_by, v_user_id
      )
    then raise exception 'time_correction_reassignment_not_responsible'; end if;
  end loop;
  return new;
end;
$$;

create trigger validate_time_correction_application_targets
before insert on public.time_correction_applications
for each row execute function app_private.validate_time_correction_application_targets();

revoke all on function app_private.validate_time_correction_application_targets()
from public, anon, authenticated, service_role;
