-- An acknowledged requirement recomputes its onboarding plan's state with the
-- plan locked (werk-flow/werkflow-planning#436).
--
-- acknowledge_personnel_item_review_base fulfils a requirement and then sets
-- the plan's state from all of the plan's requirements. It bumped the plan's
-- version without holding the plan, so an acknowledgement and a concurrent
-- save or acknowledgement of another requirement of the same plan each
-- computed the state without the other's change, and the plan could stay
-- in_progress with every requirement fulfilled.
--
-- Both functions now lock the plan before the requirement, in the order
-- save_personnel_onboarding_requirement locks them, so no two writers wait on
-- each other in opposite order. Signatures, return shapes, refusals and
-- grants stay as they were; create or replace keeps the grants.
--
-- Prevention: Tier 2. lib/conventions/database-function-races.test.ts fails
-- a function that bumps a row's version without locking that row first.

create or replace function public.acknowledge_personnel_item(
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
  requirement_type public.personnel_requirement_type;
  result_id uuid;
begin
  result_id := app_private.p1_24_assert_replay(
    p_organization_id, p_operation_id, p_request_hash
  );
  if result_id is not null then return result_id; end if;
  if p_acknowledgement_kind = 'requirement_completed' then
    -- The plan before the requirement, as save_personnel_onboarding_requirement locks them.
    perform 1 from public.personnel_onboarding_plans plan
    join public.personnel_onboarding_requirements requirement on requirement.plan_id = plan.id
    where requirement.id = p_requirement_id and requirement.organization_id = p_organization_id
    for update of plan;
    select requirement.state, requirement.requirement_type
    into requirement_state, requirement_type
    from public.personnel_onboarding_requirements requirement
    where requirement.id = p_requirement_id
      and requirement.organization_id = p_organization_id
    for update;
    if requirement_state is null then raise exception 'requirement_not_found'; end if;
    if requirement_state not in ('missing', 'pending') then
      raise exception 'requirement_not_open';
    end if;
    if requirement_type <> 'acknowledgement' then raise exception 'forbidden'; end if;
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

create or replace function public.acknowledge_personnel_item_review_base(
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
  employee_id uuid;
  acknowledgement_id uuid;
  result_id uuid;
  requirement public.personnel_onboarding_requirements;
  next_plan_state public.personnel_onboarding_plan_state;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if nullif(btrim(p_statement), '') is null then raise exception 'statement_required'; end if;
  if p_acknowledgement_kind = 'document_received' then
    select protected.employee_record_id into employee_id
    from public.personnel_documents protected
    join public.personnel_document_releases release
      on release.personnel_document_id = protected.id
     and release.document_version_number = p_document_version_number
     and release.revoked_at is null
    where protected.id = p_personnel_document_id
      and protected.organization_id = p_organization_id;
    if employee_id is null then raise exception 'document_not_released'; end if;
  elsif p_acknowledgement_kind = 'requirement_completed' then
    perform 1 from public.personnel_onboarding_plans plan
    join public.personnel_onboarding_requirements requirement on requirement.plan_id = plan.id
    where requirement.id = p_requirement_id and requirement.organization_id = p_organization_id
    for update of plan;
    select * into requirement from public.personnel_onboarding_requirements
    where id = p_requirement_id and organization_id = p_organization_id for update;
    if requirement.id is null then raise exception 'requirement_not_found'; end if;
    if requirement.version <> p_requirement_version then raise exception 'stale_version'; end if;
    employee_id := requirement.employee_record_id;
  else
    raise exception 'invalid_acknowledgement';
  end if;
  if not app_private.p1_24_is_self(p_organization_id, employee_id, p_actor_id, true)
  then raise exception 'forbidden'; end if;
  insert into public.personnel_acknowledgements(
    organization_id, employee_record_id, acknowledgement_kind,
    personnel_document_id, document_version_number, requirement_id,
    requirement_version, statement, acknowledged_by, operation_id, request_hash
  ) values (
    p_organization_id, employee_id, p_acknowledgement_kind,
    p_personnel_document_id, p_document_version_number, p_requirement_id,
    p_requirement_version, btrim(p_statement), p_actor_id, p_operation_id, p_request_hash
  ) returning id into acknowledgement_id;
  if requirement.id is not null then
    update public.personnel_onboarding_requirements set
      state = 'fulfilled', version = version + 1, updated_by = p_actor_id
    where id = requirement.id;
    select case
      when exists (
        select 1 from public.personnel_onboarding_requirements item
        where item.plan_id = requirement.plan_id and item.state = 'blocked'
      ) then 'blocked'::public.personnel_onboarding_plan_state
      when not exists (
        select 1 from public.personnel_onboarding_requirements item
        where item.plan_id = requirement.plan_id and item.is_required
          and item.state not in ('fulfilled', 'waived')
      ) then 'ready'::public.personnel_onboarding_plan_state
      else 'in_progress'::public.personnel_onboarding_plan_state
    end into next_plan_state;
    update public.personnel_onboarding_plans set
      state = next_plan_state, version = version + 1, updated_by = p_actor_id
    where id = requirement.plan_id;
  end if;
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, employee_id, 'personnel_acknowledged',
    jsonb_build_object(
      'acknowledgementId', acknowledgement_id, 'kind', p_acknowledgement_kind,
      'personnelDocumentId', p_personnel_document_id,
      'documentVersionNumber', p_document_version_number,
      'requirementId', p_requirement_id, 'requirementVersion', p_requirement_version
    ), p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'acknowledge_personnel_item', acknowledgement_id, p_actor_id
  );
  return acknowledgement_id;
end;
$$;
