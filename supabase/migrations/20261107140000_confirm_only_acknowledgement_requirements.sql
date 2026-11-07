-- An employee confirms only an acknowledgement requirement. Admin or Büro
-- completes every other type through save_personnel_onboarding_requirement.
-- Same signature and return shape as 20260902085933; only the type check is new.

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

revoke all on function public.acknowledge_personnel_item(
  uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer,
  uuid, bigint, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.acknowledge_personnel_item(
  uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer,
  uuid, bigint, text, uuid, text
) to service_role;
