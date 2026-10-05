-- Adding, renewing and correcting an employee's skill or certification write
-- the capability row and its employee record history row together or not at
-- all. addEmployeeCapability and updateEmployeeCapability in
-- lib/qualifications/actions.ts wrote employee_capabilities first (a renewal
-- through renew_employee_capability) and then inserted the
-- employee_record_events row through recordEmployeeRecordEvent, whose failure
-- was only logged, so a qualification could change without its history row.
-- The definition, employee and record pre-checks were separate reads before
-- the write, and the 'qualification_corrected' history recorded the values
-- read before the write.
--
-- Division of work: the action establishes identity, the active membership,
-- the role and the organization, validates the input and passes server-resolved
-- values. Each function locks the actor's membership and the rows it depends
-- on, repeats the state checks under those locks and raises the action failure
-- code of the first refusal, so nothing changes. The exclusion constraints
-- employee_capabilities_skill_no_overlap and
-- employee_capabilities_certification_no_overlap and the unique index
-- employee_capabilities_supersedes_unique decide an overlap.
--
-- Signals stay as before: the write to employee_capabilities reaches its
-- Realtime publication; employee_record_events stays unpublished.
--
-- renew_employee_capability is replaced by add_employee_capability. It stays
-- in place: the build that is deployed when this migration is applied still
-- calls it, so a later migration drops it after that build is replaced.

-- Adds a capability record for an employee, or renews a current certification
-- record when p_supersedes_id names it, and records 'qualification_added' or
-- 'qualification_renewed'. A skill keeps no issuer, renewal date,
-- confirmation or evidence. Refusals: invalid_input, not_authorized,
-- definition_not_found, employee_not_found, record_not_found (the renewed
-- record is not current), overlap. Returns the new record id.
create function public.add_employee_capability(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_capability_id uuid,
  p_valid_from date,
  p_valid_until date,
  p_issuer text,
  p_renewal_due_date date,
  p_confirmation_status text,
  p_evidence_state text,
  p_operational_note text,
  p_supersedes_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_kind text;
  v_is_certification boolean;
  v_confirmation_status text;
  v_evidence_state text;
  v_record_id uuid;
begin
  if p_actor_id is null or p_organization_id is null or p_employee_record_id is null
    or p_capability_id is null or p_valid_from is null
    or (p_valid_until is not null and p_valid_until < p_valid_from)
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);

  select capability.kind into v_kind from public.organization_capabilities capability
  where capability.organization_id = p_organization_id and capability.id = p_capability_id
    and capability.retired_at is null
  for share;
  if not found then raise exception 'definition_not_found'; end if;
  perform 1 from public.employee_records record
  where record.organization_id = p_organization_id and record.id = p_employee_record_id
  for key share;
  if not found then raise exception 'employee_not_found'; end if;

  v_is_certification := v_kind = 'certification';
  v_confirmation_status := case when v_is_certification then coalesce(p_confirmation_status, 'unconfirmed')
    else 'unconfirmed' end;
  v_evidence_state := case when v_is_certification then coalesce(p_evidence_state, 'not_required')
    else 'not_required' end;
  if v_confirmation_status not in ('unconfirmed', 'confirmed')
    or v_evidence_state not in ('not_required', 'pending', 'received')
    or (p_supersedes_id is not null and not v_is_certification)
  then
    raise exception 'invalid_input';
  end if;

  if p_supersedes_id is not null then
    update public.employee_capabilities capability
    set superseded_at = now(), updated_by = p_actor_id
    where capability.organization_id = p_organization_id and capability.id = p_supersedes_id
      and capability.employee_record_id = p_employee_record_id
      and capability.capability_id = p_capability_id and capability.superseded_at is null;
    if not found then raise exception 'record_not_found'; end if;
  end if;

  begin
    insert into public.employee_capabilities (
      organization_id, employee_record_id, capability_id, capability_kind, valid_from, valid_until,
      issuer, renewal_due_date, confirmation_status, confirmed_by, confirmed_at, evidence_state,
      operational_note, supersedes_id, created_by, updated_by
    ) values (
      p_organization_id, p_employee_record_id, p_capability_id, v_kind, p_valid_from, p_valid_until,
      case when v_is_certification then p_issuer end,
      case when v_is_certification then p_renewal_due_date end,
      v_confirmation_status,
      case when v_confirmation_status = 'confirmed' then p_actor_id end,
      case when v_confirmation_status = 'confirmed' then now() end,
      v_evidence_state, p_operational_note, p_supersedes_id, p_actor_id, p_actor_id
    )
    returning id into v_record_id;
  exception when exclusion_violation or unique_violation then
    raise exception 'overlap';
  end;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_employee_record_id,
    case when p_supersedes_id is null then 'qualification_added' else 'qualification_renewed' end,
    jsonb_build_object(
      'employee_capability_id', v_record_id, 'capability_id', p_capability_id, 'kind', v_kind,
      'valid_from', p_valid_from, 'valid_until', p_valid_until, 'supersedes_id', p_supersedes_id
    ),
    p_actor_id
  );

  return v_record_id;
end;
$$;

-- Corrects a capability record and records 'qualification_corrected' with the
-- values before and after, both read under the lock. A skill keeps no issuer,
-- renewal date, confirmation or evidence. Refusals: invalid_input,
-- record_not_found, not_authorized, overlap.
create function public.update_employee_capability(
  p_actor_id uuid,
  p_organization_id uuid,
  p_record_id uuid,
  p_valid_from date,
  p_valid_until date,
  p_issuer text,
  p_renewal_due_date date,
  p_confirmation_status text,
  p_evidence_state text,
  p_operational_note text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.employee_capabilities;
  v_updated public.employee_capabilities;
  v_is_certification boolean;
begin
  if p_actor_id is null or p_organization_id is null or p_record_id is null or p_valid_from is null
    or (p_valid_until is not null and p_valid_until < p_valid_from)
    or p_confirmation_status is null or p_confirmation_status not in ('unconfirmed', 'confirmed')
    or p_evidence_state is null or p_evidence_state not in ('not_required', 'pending', 'received')
  then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.employee_capabilities capability
  where capability.organization_id = p_organization_id and capability.id = p_record_id
  for no key update;
  if not found then raise exception 'record_not_found'; end if;
  perform app_private.lock_qualification_actor(p_organization_id, p_actor_id, array['admin', 'buero']::public.org_role[]);
  v_is_certification := v_previous.capability_kind = 'certification';

  begin
    update public.employee_capabilities capability
    set valid_from = p_valid_from,
        valid_until = p_valid_until,
        issuer = case when v_is_certification then p_issuer end,
        renewal_due_date = case when v_is_certification then p_renewal_due_date end,
        confirmation_status = case when v_is_certification then p_confirmation_status else 'unconfirmed' end,
        confirmed_by = case when v_is_certification and p_confirmation_status = 'confirmed' then p_actor_id end,
        confirmed_at = case when v_is_certification and p_confirmation_status = 'confirmed' then now() end,
        evidence_state = case when v_is_certification then p_evidence_state else 'not_required' end,
        operational_note = p_operational_note,
        updated_by = p_actor_id
    where capability.organization_id = p_organization_id and capability.id = p_record_id
    returning * into v_updated;
  exception when exclusion_violation then
    raise exception 'overlap';
  end;

  insert into public.employee_record_events (
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_previous.employee_record_id, 'qualification_corrected',
    jsonb_build_object(
      'employee_capability_id', p_record_id,
      'before', jsonb_build_object(
        'valid_from', v_previous.valid_from, 'valid_until', v_previous.valid_until,
        'issuer', v_previous.issuer, 'renewal_due_date', v_previous.renewal_due_date,
        'confirmation_status', v_previous.confirmation_status,
        'evidence_state', v_previous.evidence_state, 'operational_note', v_previous.operational_note
      ),
      'after', jsonb_build_object(
        'valid_from', v_updated.valid_from, 'valid_until', v_updated.valid_until,
        'issuer', v_updated.issuer, 'renewal_due_date', v_updated.renewal_due_date,
        'confirmation_status', v_updated.confirmation_status, 'confirmed_by', v_updated.confirmed_by,
        'confirmed_at', v_updated.confirmed_at, 'evidence_state', v_updated.evidence_state,
        'operational_note', v_updated.operational_note, 'updated_by', v_updated.updated_by
      )
    ),
    p_actor_id
  );
end;
$$;

revoke all on function public.add_employee_capability(
  uuid, uuid, uuid, uuid, date, date, text, date, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.update_employee_capability(
  uuid, uuid, uuid, date, date, text, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.add_employee_capability(
  uuid, uuid, uuid, uuid, date, date, text, date, text, text, text, uuid
) to service_role;
grant execute on function public.update_employee_capability(
  uuid, uuid, uuid, date, date, text, date, text, text, text
) to service_role;
