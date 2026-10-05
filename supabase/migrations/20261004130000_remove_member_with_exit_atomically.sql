-- Removing a member and marking the personnel record as exited is one
-- transaction. The server action removeMember (lib/members/actions.ts) removed
-- the membership through this function and then wrote the exit date and the
-- membership_removed event in separate statements, so a refused exit date
-- (employee_records_exit_after_entry, an entry date after today) left the
-- membership gone, the record without an exit and the action reporting
-- success. The function now writes all three or nothing.
--
-- Division of work is unchanged: the action establishes identity, the active
-- membership, the caller's role over the target and the stranded
-- responsibilities. This function repeats the state checks under its locks.
-- Refusals: time_member_removal_target_missing,
-- time_member_removal_has_history, member_removal_exit_before_entry, and the
-- last_responsibility_holder:<responsibility> refusal of the membership
-- trigger. Returns whether an open session was closed (auto clock-out).
create or replace function public.remove_member_with_time_capture(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
set search_path to ''
as $$
declare
  -- The Europe/Berlin business date, as getBusinessTodayIso in TypeScript.
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_canonical_closed boolean;
  v_record_id uuid;
  v_entry_date date;
  v_exit_date date;
begin
  perform 1 from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_target_user_id
  for update;
  if not found then raise exception 'time_member_removal_target_missing'; end if;

  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id
      and entry.user_id = p_target_user_id
  ) or exists (
    select 1 from public.time_sessions session
    where session.organization_id = p_organization_id
      and session.user_id = p_target_user_id
  ) then raise exception 'time_member_removal_has_history'; end if;

  select employee.id, employee.entry_date, employee.exit_date
  into v_record_id, v_entry_date, v_exit_date
  from public.employee_records employee
  where employee.organization_id = p_organization_id
    and employee.user_id = p_target_user_id
  for update;
  -- A person whose entry lies after today cannot exit today; refuse before
  -- anything changes instead of dropping the exit date.
  if v_record_id is not null
    and (v_exit_date is null or v_exit_date >= v_today)
    and v_entry_date > v_today
  then raise exception 'member_removal_exit_before_entry'; end if;

  v_canonical_closed := coalesce(public.close_time_session_for_member_removal(
    p_organization_id, p_target_user_id, p_actor_id, p_operation_id
  ), false);

  delete from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_target_user_id;
  if not found then raise exception 'time_member_removal_target_missing'; end if;

  -- The personnel record survives the removal and is marked as exited, so the
  -- person stays distinguishable in history (P1-03, owner-approved).
  if v_record_id is not null and (v_exit_date is null or v_exit_date >= v_today) then
    update public.employee_records employee
    set exit_date = v_today
    where employee.id = v_record_id and employee.organization_id = p_organization_id;
    insert into public.employee_record_events (
      organization_id, employee_record_id, event_type, event_payload, created_by
    ) values (
      p_organization_id, v_record_id, 'membership_removed',
      jsonb_build_object('exit_date', v_today, 'auto_clocked_out', v_canonical_closed),
      p_actor_id
    );
  end if;

  return v_canonical_closed;
end;
$$;

revoke all on function public.remove_member_with_time_capture(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_member_with_time_capture(uuid, uuid, uuid, uuid) to service_role;
