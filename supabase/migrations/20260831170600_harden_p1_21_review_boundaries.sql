-- P1-21 review hardening: scope cascade exemptions, preserve nested GUC state,
-- and keep idempotent work-artifact replay tenant-bound.

create or replace function app_private.mark_time_capture_organization_delete()
returns trigger
language plpgsql
security definer
as $$
begin
  perform set_config('app.time_capture_cascade_organization_id', old.id::text, true);
  return old;
end;
$$;

drop trigger if exists mark_p1_21_time_capture_organization_delete
on public.organizations;
create trigger mark_p1_21_time_capture_organization_delete
before delete on public.organizations
for each row execute function app_private.mark_time_capture_organization_delete();

revoke all on function app_private.mark_time_capture_organization_delete()
from public, anon, authenticated;
grant execute on function app_private.mark_time_capture_organization_delete()
to postgres, service_role;

create or replace function app_private.guard_time_capture_write()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('app.time_capture_cascade_organization_id', true)
      = old.organization_id::text
  then return old; end if;
  if current_setting('app.time_capture_write', true) is distinct from 'true' then
    raise exception 'time_capture_direct_write_forbidden';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app_private.guard_time_capture_append_only()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'DELETE'
    and current_setting('app.time_capture_cascade_organization_id', true)
      = old.organization_id::text
  then return old; end if;
  raise exception 'time_capture_append_only';
end;
$$;

create or replace function app_private.start_work_from_time_activity(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version bigint
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_previous_origin text := coalesce(
    current_setting('app.work_transition_origin', true), ''
  );
begin
  perform set_config('app.work_transition_origin', 'automatic_time_start', true);
  perform public.transition_work_execution(
    p_organization_id, p_actor_id, 'job', p_job_id,
    p_expected_version, 'in_progress', null, false
  );
  perform set_config('app.work_transition_origin', v_previous_origin, true);
end;
$$;

create or replace function public.link_work_artifact_time_segment(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_link_id uuid,
  p_expected_version bigint,
  p_time_segment_id uuid,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing public.work_artifact_revision_sources%rowtype;
  v_version bigint;
begin
  select * into v_existing
  from public.work_artifact_revision_sources source
  where source.id = p_link_id
    and source.organization_id = p_organization_id;
  if found then
    if v_existing.revision_id <> p_revision_id
      or v_existing.time_segment_id is distinct from p_time_segment_id
    then raise exception 'work_artifact_source_idempotency_conflict'; end if;
    select * into v_artifact
    from public.work_artifacts artifact
    where artifact.id = p_artifact_id
      and artifact.organization_id = p_organization_id;
    if not found then raise exception 'work_artifact_not_found'; end if;
    return jsonb_build_object(
      'linkId', p_link_id,
      'version', v_artifact.version,
      'duplicate', true
    );
  end if;

  select * into v_artifact
  from public.work_artifacts artifact
  where artifact.id = p_artifact_id
    and artifact.organization_id = p_organization_id
  for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided'
  then raise exception 'work_artifact_is_voided'; end if;
  if v_artifact.version is distinct from p_expected_version
  then raise exception 'work_artifact_stale_version'; end if;
  if v_artifact.current_revision_id is distinct from p_revision_id
  then raise exception 'work_artifact_relation_requires_current_revision'; end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  insert into public.work_artifact_revision_sources (
    id, organization_id, revision_id, time_segment_id, description, created_by
  ) values (
    p_link_id, p_organization_id, p_revision_id, p_time_segment_id,
    nullif(btrim(p_description), ''), p_actor_id
  );
  v_version := v_artifact.version + 1;
  update public.work_artifacts
  set version = v_version, updated_at = now()
  where id = p_artifact_id;
  return jsonb_build_object(
    'linkId', p_link_id,
    'version', v_version,
    'duplicate', false
  );
end;
$$;

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
  v_previous_capture_write text := coalesce(
    current_setting('app.time_capture_write', true), ''
  );
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

  perform set_config(
    'app.time_capture_write', v_previous_capture_write, true
  );
  return true;
end;
$$;
