-- Serialize lifecycle and document-boundary checks, and keep access time stable.

create or replace function app_private.p1_24_effective_access_state(
  p_organization_id uuid,
  p_user_id uuid,
  p_at timestamptz default now()
)
returns public.personnel_access_state
language sql stable security definer set search_path = '' as $$
  select case
    when member.user_id is null then 'ended'::public.personnel_access_state
    when lifecycle.id is null then 'active'::public.personnel_access_state
    when lifecycle.scheduled_for is not null
      and lifecycle.scheduled_for <= p_at
      and lifecycle.scheduled_state = 'active'
      and exists (
        select 1
        from public.personnel_onboarding_requirements requirement
        where requirement.employee_record_id = employee.id
          and requirement.organization_id = p_organization_id
          and requirement.blocks_access
          and requirement.state not in ('fulfilled', 'waived', 'cancelled')
      ) then 'scheduled'::public.personnel_access_state
    when lifecycle.scheduled_for is not null
      and lifecycle.scheduled_for <= p_at
      then lifecycle.scheduled_state
    else lifecycle.state
  end
  from (select p_user_id as user_id) requested
  left join public.organization_members member
    on member.organization_id = p_organization_id
   and member.user_id = requested.user_id
  left join public.employee_records employee
    on employee.organization_id = member.organization_id
   and employee.user_id = member.user_id
  left join public.personnel_access_lifecycles lifecycle
    on lifecycle.employee_record_id = employee.id;
$$;

create or replace function app_private.p1_24_has_effective_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_at timestamptz default now()
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    app_private.p1_24_effective_access_state(p_organization_id, p_user_id, p_at) = 'active',
    false
  );
$$;

create or replace function app_private.p1_24_has_prestart_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_at timestamptz default now()
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members member
    join public.employee_records employee
      on employee.organization_id = member.organization_id
     and employee.user_id = member.user_id
    join public.personnel_access_lifecycles lifecycle
      on lifecycle.employee_record_id = employee.id
    where member.organization_id = p_organization_id
      and member.user_id = p_user_id
      and lifecycle.state = 'scheduled'
      and lifecycle.scheduled_state = 'active'
      and (
        lifecycle.scheduled_for > p_at
        or exists (
          select 1
          from public.personnel_onboarding_requirements requirement
          where requirement.employee_record_id = employee.id
            and requirement.organization_id = p_organization_id
            and requirement.blocks_access
            and requirement.state not in ('fulfilled', 'waived', 'cancelled')
        )
      )
  );
$$;

create or replace function app_private.validate_p1_24_personnel_document_boundary()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  document_folder_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'p1-24-document:' || new.document_id::text, 0
  ));
  select document.folder_id into document_folder_id
  from public.documents document
  where document.id = new.document_id
    and document.organization_id = new.organization_id;
  if not found then raise exception 'document_organization_mismatch'; end if;
  if document_folder_id is not null then
    raise exception 'personnel_document_must_be_unfoldered';
  end if;
  if exists (
    select 1 from public.document_links link
    where link.document_id = new.document_id
  ) then
    raise exception 'ordinary_document_links_must_be_removed_first';
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_p1_24_ordinary_document_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'p1-24-document:' || new.document_id::text, 0
  ));
  if exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = new.document_id
  ) then
    raise exception 'protected_personnel_document_cannot_be_linked';
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_p1_24_protected_document_folder()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'p1-24-document:' || new.id::text, 0
  ));
  if new.folder_id is not null and exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = new.id
  ) then
    raise exception 'protected_personnel_document_must_be_unfoldered';
  end if;
  return new;
end;
$$;

create or replace function public.set_personnel_access_transition(
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
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-24-access:' || p_employee_record_id::text, 0
  ));

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
    state_effective_at = case
      when target_state is distinct from lifecycle.state then effective_at
      else state_effective_at
    end,
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
