-- A finding decision changes what the period detail shows: the decision
-- label, the open approval count and whether the period may close. Its rows
-- (time_period_finding_decisions) are an unpublished ledger, so other
-- signed-in sessions never learned about a decision. Every other period RPC
-- bumps the published root time_periods; this replacement does the same, so
-- every writer of a decision signals the pages that subscribe to the root.
--
-- The period row is locked before the decision is written. A concurrent
-- close_time_period, which takes the same row FOR UPDATE before it reads the
-- decisions, therefore sees either all of this decision or none of it.
--
-- An idempotent replay (same operation id) returns the stored decision and
-- writes nothing, so it does not signal again. The signature, the result and
-- the grants stay as before.

create or replace function public.decide_time_period_finding(
  p_actor_id uuid,
  p_organization_id uuid,
  p_finding_id uuid,
  p_decision public.time_period_finding_decision,
  p_reason text,
  p_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  finding_record public.time_period_findings%rowtype;
  decision_id uuid;
  v_period_id uuid;
begin
  select * into finding_record from public.time_period_findings
  where id = p_finding_id and organization_id = p_organization_id;
  if not found then raise exception 'finding_not_found'; end if;
  if finding_record.employee_record_id is not null
     and not app_private.can_p1_23_approve_employee(p_organization_id, p_actor_id, finding_record.employee_record_id) then
    raise exception 'forbidden';
  elsif finding_record.employee_record_id is null
     and not app_private.is_p1_23_time_holder(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  select id into decision_id from public.time_period_finding_decisions
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then return decision_id; end if;

  select period.id into v_period_id
  from public.time_period_calculations calculation
  join public.time_periods period
    on period.id = calculation.period_id and period.organization_id = calculation.organization_id
  where calculation.id = finding_record.calculation_id
    and calculation.organization_id = p_organization_id
  for update of period;
  if not found then raise exception 'period_not_found'; end if;

  insert into public.time_period_finding_decisions (
    organization_id, finding_id, decision, reason, decided_by, operation_id, responsibility_snapshot
  ) values (
    p_organization_id, p_finding_id, p_decision, p_reason, p_actor_id, p_operation_id,
    jsonb_build_object('responsibility', 'time_approval', 'captured_at', now())
  ) returning id into decision_id;

  update public.time_periods set version = version + 1, updated_at = now()
  where id = v_period_id and organization_id = p_organization_id;
  return decision_id;
end;
$$;

revoke all on function public.decide_time_period_finding(
  uuid, uuid, uuid, public.time_period_finding_decision, text, uuid
) from public, anon, authenticated;
grant execute on function public.decide_time_period_finding(
  uuid, uuid, uuid, public.time_period_finding_decision, text, uuid
) to service_role;
