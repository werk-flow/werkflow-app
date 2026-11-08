-- A responsibility delegation ends once (werk-flow/werkflow-planning#152).
-- Two requests that read the same unended window, such as „Entfernen“ from
-- two tabs, could both write a revocation and an end event; the second could
-- turn a removed window into an ended one. The function now refuses an
-- already ended window under its row lock. Signature, grants and every other
-- check stay as they were.

create or replace function public.end_responsibility_delegation(
  p_delegation_id uuid,
  p_revoked_from date,
  p_actor_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  delegation_record public.organization_responsibility_delegations;
  berlin_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  select * into delegation_record
  from public.organization_responsibility_delegations
  where id = p_delegation_id
  for update;

  if delegation_record.id is null then
    raise exception 'responsibility_delegation_not_found';
  end if;

  if p_actor_id is distinct from (
    select o.admin_id from public.organizations o
    where o.id = delegation_record.organization_id
  ) then
    raise exception 'responsibility_configuration_admin_only';
  end if;

  -- A window ends once. Two requests that read the same open window wait on
  -- the row lock above; the second finds it ended and changes nothing.
  if delegation_record.revoked_from is not null then
    raise exception 'responsibility_delegation_already_ended';
  end if;

  if p_revoked_from < berlin_today
     or p_revoked_from < delegation_record.valid_from
     or p_revoked_from > delegation_record.valid_until + 1 then
    raise exception 'responsibility_delegation_invalid_revocation_date';
  end if;

  update public.organization_responsibility_delegations
  set revoked_from = p_revoked_from
  where id = p_delegation_id;

  insert into public.organization_responsibility_events (
    organization_id, responsibility, event_type, delegation_id,
    primary_employee_record_id, related_employee_record_id, event_payload, created_by
  )
  values (
    delegation_record.organization_id,
    delegation_record.responsibility,
    'delegation_ended',
    delegation_record.id,
    delegation_record.delegator_employee_record_id,
    delegation_record.substitute_employee_record_id,
    jsonb_build_object('revoked_from', p_revoked_from),
    p_actor_id
  );
end;
$$;
