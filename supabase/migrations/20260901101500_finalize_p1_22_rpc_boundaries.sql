-- Keep the original RPC implementations focused on the domain transition,
-- while wrappers enforce strict nullable-input and source-locking boundaries.

create or replace function app_private.lock_time_correction_sources(
  p_organization_id uuid,
  p_sources jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_source jsonb;
  v_source_kind public.time_correction_source_kind;
  v_source_id uuid;
begin
  for v_source in select value from jsonb_array_elements(p_sources)
  loop
    begin
      v_source_kind := (v_source ->> 'kind')::public.time_correction_source_kind;
      v_source_id := (v_source ->> 'id')::uuid;
    exception when others then
      raise exception 'time_correction_source_invalid';
    end;
    if v_source_kind = 'legacy_entry' then
      perform 1 from public.time_entries
      where id = v_source_id and organization_id = p_organization_id
      for update;
    elsif v_source_kind = 'canonical_session' then
      perform 1 from public.time_sessions
      where id = v_source_id and organization_id = p_organization_id
      for update;
    elsif v_source_kind = 'canonical_segment' then
      perform 1 from public.time_segments
      where id = v_source_id and organization_id = p_organization_id
      for update;
    else
      perform 1
      from public.time_correction_applications application
      join public.time_correction_requests request
        on request.id = application.request_id
      where application.id = v_source_id
        and application.organization_id = p_organization_id
      for update of application, request;
    end if;
  end loop;
end;
$$;

revoke all on function app_private.lock_time_correction_sources(uuid, jsonb)
from public, anon, authenticated, service_role;

alter function public.create_time_correction_request(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) rename to p1_22_create_time_correction_request_impl;
alter function public.p1_22_create_time_correction_request_impl(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) set schema app_private;

create function public.create_time_correction_request(
  p_organization_id uuid,
  p_subject_employee_record_id uuid,
  p_actor_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_reason text,
  p_source_scope_key text,
  p_source_fingerprint text,
  p_before_snapshot jsonb,
  p_proposed_snapshot jsonb,
  p_sources jsonb,
  p_responsibility_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
set timezone to 'UTC'
as $$
begin
  if p_before_snapshot is null
    or p_proposed_snapshot is null
    or p_sources is null
  then raise exception 'time_correction_invalid_input'; end if;
  perform app_private.lock_time_correction_sources(p_organization_id, p_sources);
  return app_private.p1_22_create_time_correction_request_impl(
    p_organization_id, p_subject_employee_record_id, p_actor_id,
    p_operation_id, p_kind, p_reason, p_source_scope_key,
    p_source_fingerprint, p_before_snapshot, p_proposed_snapshot,
    p_sources, p_responsibility_snapshot
  );
end;
$$;

revoke all on function app_private.p1_22_create_time_correction_request_impl(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_time_correction_request(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_time_correction_request(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) to service_role;

alter function public.revise_time_correction_request(
  uuid, uuid, uuid, bigint, text, text, text, jsonb, jsonb, jsonb
) rename to p1_22_revise_time_correction_request_impl;
alter function public.p1_22_revise_time_correction_request_impl(
  uuid, uuid, uuid, bigint, text, text, text, jsonb, jsonb, jsonb
) set schema app_private;

create function public.revise_time_correction_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_source_scope_key text,
  p_source_fingerprint text,
  p_before_snapshot jsonb,
  p_proposed_snapshot jsonb,
  p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
set timezone to 'UTC'
as $$
declare
  v_organization_id uuid;
begin
  if p_before_snapshot is null
    or p_proposed_snapshot is null
    or p_sources is null
  then raise exception 'time_correction_invalid_input'; end if;
  select organization_id into v_organization_id
  from public.time_correction_requests
  where id = p_request_id
  for update;
  if v_organization_id is null then
    raise exception 'time_correction_not_found';
  end if;
  perform app_private.lock_time_correction_sources(v_organization_id, p_sources);
  return app_private.p1_22_revise_time_correction_request_impl(
    p_request_id, p_actor_id, p_operation_id, p_expected_revision,
    p_reason, p_source_scope_key, p_source_fingerprint,
    p_before_snapshot, p_proposed_snapshot, p_sources
  );
end;
$$;

revoke all on function app_private.p1_22_revise_time_correction_request_impl(
  uuid, uuid, uuid, bigint, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.revise_time_correction_request(
  uuid, uuid, uuid, bigint, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.revise_time_correction_request(
  uuid, uuid, uuid, bigint, text, text, text, jsonb, jsonb, jsonb
) to service_role;

create or replace function public.withdraw_time_correction(
  p_request_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.time_correction_requests%rowtype;
  v_existing public.time_correction_events%rowtype;
begin
  select * into v_existing from public.time_correction_events
  where operation_id = p_operation_id;
  if found then
    if v_existing.request_id <> p_request_id
      or v_existing.event_type <> 'withdrawn'
    then raise exception 'time_correction_idempotency_conflict'; end if;
    return jsonb_build_object(
      'requestId', p_request_id, 'status', 'withdrawn', 'replayed', true
    );
  end if;
  select * into v_request from public.time_correction_requests
  where id = p_request_id for update;
  if not found then raise exception 'time_correction_not_found'; end if;
  if v_request.requested_by <> p_actor_id then
    raise exception 'time_correction_not_requester';
  end if;
  if v_request.status not in ('submitted', 'clarification_required') then
    raise exception 'time_correction_not_withdrawable';
  end if;
  update public.time_correction_requests set
    status = 'withdrawn', reviewed_by = null, reviewed_at = null
  where id = p_request_id;
  insert into public.time_correction_events (
    organization_id, request_id, revision, event_type, actor_id, operation_id
  ) values (
    v_request.organization_id, p_request_id, v_request.current_revision,
    'withdrawn', p_actor_id, p_operation_id
  );
  return jsonb_build_object(
    'requestId', p_request_id, 'status', 'withdrawn', 'replayed', false
  );
end;
$$;

revoke all on function public.withdraw_time_correction(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.withdraw_time_correction(uuid, uuid, uuid)
to service_role;
