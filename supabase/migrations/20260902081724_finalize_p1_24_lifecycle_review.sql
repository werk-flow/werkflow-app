-- Close lifecycle-state findings without changing any deploy-day row.

alter table public.personnel_access_lifecycles
  drop constraint personnel_access_lifecycles_scheduled_state_shape,
  add constraint personnel_access_lifecycles_scheduled_state_shape check (
    state <> 'scheduled'
    or (scheduled_state = 'active' and scheduled_for is not null)
  );

alter function public.set_personnel_access_transition(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) rename to set_personnel_access_transition_review_base;

revoke all on function public.set_personnel_access_transition_review_base(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) from public, anon, authenticated, service_role;

create function public.set_personnel_access_transition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_expected_version bigint,
  p_transition_kind public.personnel_access_transition_kind,
  p_effective_at timestamptz,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  lifecycle public.personnel_access_lifecycles;
  target_state public.personnel_access_state;
  result_id uuid;
  effective_at timestamptz;
  new_version bigint;
begin
  if p_transition_kind = 'end_access' and p_effective_at > clock_timestamp() then
    raise exception 'immediate_effective_at_required';
  end if;

  if p_transition_kind <> 'cancel_scheduled' then
    return public.set_personnel_access_transition_review_base(
      p_actor_id, p_organization_id, p_employee_record_id, p_expected_version,
      p_transition_kind, p_effective_at, p_reason, p_operation_id, p_request_hash
    );
  end if;

  result_id := app_private.p1_24_assert_replay(
    p_organization_id, p_operation_id, p_request_hash
  );
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  if p_effective_at is null or nullif(btrim(p_reason), '') is null then
    raise exception 'invalid_transition';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-24-access:' || p_employee_record_id::text, 0
  ));
  select * into lifecycle
  from public.personnel_access_lifecycles
  where employee_record_id = p_employee_record_id
    and organization_id = p_organization_id
  for update;
  if lifecycle.id is null or lifecycle.scheduled_state is null
     or lifecycle.scheduled_for <= clock_timestamp() then
    raise exception 'no_scheduled_transition';
  end if;
  if p_expected_version is distinct from lifecycle.version then
    raise exception 'stale_version';
  end if;

  target_state := case
    when lifecycle.state = 'scheduled' then 'not_configured'::public.personnel_access_state
    else lifecycle.state
  end;
  effective_at := clock_timestamp();
  new_version := lifecycle.version + 1;

  update public.personnel_access_lifecycles set
    state = target_state,
    state_effective_at = effective_at,
    scheduled_state = null,
    scheduled_for = null,
    version = new_version,
    updated_by = p_actor_id
  where id = lifecycle.id;

  insert into public.personnel_access_transitions(
    organization_id, access_lifecycle_id, employee_record_id, transition_kind,
    from_state, to_state, effective_at, reason, lifecycle_version,
    operation_id, request_hash, actor_id
  ) values (
    p_organization_id, lifecycle.id, p_employee_record_id, p_transition_kind,
    lifecycle.state, target_state, effective_at, btrim(p_reason), new_version,
    p_operation_id, p_request_hash, p_actor_id
  );
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_employee_record_id, 'access_transition',
    jsonb_build_object(
      'transitionKind', p_transition_kind, 'fromState', lifecycle.state,
      'toState', target_state, 'effectiveAt', effective_at,
      'lifecycleVersion', new_version, 'reason', btrim(p_reason)
    ), p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'access_transition', lifecycle.id, p_actor_id
  );
  return lifecycle.id;
end;
$$;

revoke all on function public.set_personnel_access_transition(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_personnel_access_transition(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) to service_role;

alter function public.acknowledge_personnel_item(
  uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer,
  uuid, bigint, text, uuid, text
) rename to acknowledge_personnel_item_review_base;

revoke all on function public.acknowledge_personnel_item_review_base(
  uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer,
  uuid, bigint, text, uuid, text
) from public, anon, authenticated, service_role;

create function public.acknowledge_personnel_item(
  p_actor_id uuid,
  p_organization_id uuid,
  p_acknowledgement_kind public.personnel_acknowledgement_kind,
  p_personnel_document_id uuid,
  p_document_version_number integer,
  p_requirement_id uuid,
  p_requirement_version bigint,
  p_statement text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  requirement_state public.personnel_requirement_state;
  result_id uuid;
begin
  if p_acknowledgement_kind = 'requirement_completed' then
    select state into requirement_state
    from public.personnel_onboarding_requirements
    where id = p_requirement_id and organization_id = p_organization_id;
    if requirement_state is null then raise exception 'requirement_not_found'; end if;
    if requirement_state not in ('missing', 'pending') then
      raise exception 'requirement_not_open';
    end if;
  end if;

  result_id := public.acknowledge_personnel_item_review_base(
    p_actor_id, p_organization_id, p_acknowledgement_kind,
    p_personnel_document_id, p_document_version_number, p_requirement_id,
    p_requirement_version, p_statement, p_operation_id, p_request_hash
  );
  if p_acknowledgement_kind = 'requirement_completed' then
    update public.personnel_onboarding_requirements
    set blocker_reason = null
    where id = p_requirement_id and organization_id = p_organization_id;
  end if;
  return result_id;
end;
$$;

revoke all on function public.acknowledge_personnel_item(
  uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer,
  uuid, bigint, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.acknowledge_personnel_item(
  uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer,
  uuid, bigint, text, uuid, text
) to service_role;
