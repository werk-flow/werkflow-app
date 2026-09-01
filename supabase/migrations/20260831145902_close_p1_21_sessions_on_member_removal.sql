-- P1-21: membership removal must not strand a canonical time session.

create or replace function public.close_time_session_for_member_removal(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_actor_role public.org_role;
  v_target_role public.org_role;
  v_employee public.employee_records%rowtype;
  v_session public.time_sessions%rowtype;
  v_segment public.time_segments%rowtype;
  v_result jsonb;
begin
  if p_organization_id is null or p_target_user_id is null
    or p_actor_id is null or p_operation_id is null
  then raise exception 'time_member_removal_invalid_input'; end if;

  select membership.role into v_actor_role
  from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_id;
  select membership.role into v_target_role
  from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_target_user_id;

  if v_actor_role not in ('admin', 'buero') or v_target_role is null
    or p_actor_id = p_target_user_id or v_target_role = 'admin'
    or (v_actor_role = 'buero' and v_target_role <> 'employee')
  then raise exception 'time_member_removal_not_authorized'; end if;

  select * into v_employee
  from public.employee_records employee
  where employee.organization_id = p_organization_id
    and employee.user_id = p_target_user_id
  for update;
  if not found then return false; end if;

  select * into v_session
  from public.time_sessions session
  where session.organization_id = p_organization_id
    and session.employee_record_id = v_employee.id
    and session.ended_at is null
  for update;
  if not found then return false; end if;

  select * into v_segment
  from public.time_segments segment
  where segment.session_id = v_session.id
    and segment.ended_at is null
  for update;

  perform set_config('app.time_capture_write', 'true', true);

  if v_segment.id is not null then
    update public.time_segments
    set ended_at = v_now, end_source = 'manager', ended_by = p_actor_id,
        updated_at = v_now
    where id = v_segment.id;
    insert into public.time_segment_events (
      organization_id, session_id, segment_id, operation_id, event_type,
      source, actor_id, occurred_at, event_payload
    ) values (
      p_organization_id, v_session.id, v_segment.id, p_operation_id,
      'segment_ended', 'manager', p_actor_id, v_now,
      jsonb_build_object('reason', 'membership_removed')
    );
  end if;

  update public.time_sessions
  set status = 'closed', ended_at = v_now, ended_by = p_actor_id,
      recovery_reason = null, version = version + 1, updated_at = v_now
  where id = v_session.id
  returning * into v_session;

  insert into public.time_segment_events (
    organization_id, session_id, operation_id, event_type,
    source, actor_id, occurred_at, event_payload
  ) values (
    p_organization_id, v_session.id, p_operation_id, 'session_ended',
    'manager', p_actor_id, v_now,
    jsonb_build_object('reason', 'membership_removed')
  );

  v_result := jsonb_build_object(
    'outcome', 'ended', 'sessionId', v_session.id,
    'segmentId', v_segment.id, 'version', v_session.version,
    'reason', 'membership_removed', 'replayed', false
  );
  insert into public.time_operations (
    id, organization_id, employee_record_id, actor_id, operation_kind,
    request_hash, expected_session_id, expected_version,
    resulting_session_id, resulting_segment_id, resulting_version,
    result_payload
  ) values (
    p_operation_id, p_organization_id, v_employee.id, p_actor_id,
    'system_repair', lpad(replace(p_operation_id::text, '-', ''), 64, '0'),
    v_session.id, v_session.version - 1,
    v_session.id, v_segment.id, v_session.version, v_result
  );

  perform set_config('app.time_capture_write', 'false', true);
  return true;
end;
$$;

revoke all on function public.close_time_session_for_member_removal(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.close_time_session_for_member_removal(
  uuid, uuid, uuid, uuid
) to service_role;
