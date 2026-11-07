-- A period closes only when the latest decision of every approval-required
-- finding is 'approved'. The close counted a finding as approved when any
-- 'approved' decision existed, but a 'rejected' decision may follow one (the
-- terminal unique index covers only 'acknowledged' and 'approved'). The
-- period page shows the latest decision (readLatestFindingDecisions in
-- lib/time-accounts/decision-reads.ts), so the page could show a rejection
-- while the close booked the month.
--
-- "Latest" is the order the page reads: decided_at descending, then id. The
-- close holds the period row FOR UPDATE and decide_time_period_finding takes
-- the same row FOR UPDATE before it inserts, so a decision either commits
-- before this check reads it or comes after the close has committed.
--
-- Only the approval-required check changes. The signature, the result, the
-- other checks and the grants stay as before (body from
-- 20260901129000_harden_p1_23_period_integrity.sql, renamed to the base in
-- 20260901131000_finalize_p1_23_review_boundaries.sql).

create or replace function public.close_time_period_p1_23_base(
  p_actor_id uuid, p_organization_id uuid, p_period_id uuid,
  p_operation_id uuid, p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
  calculation_record public.time_period_calculations%rowtype;
  close_id uuid := gen_random_uuid();
  close_version integer;
  prior_close_id uuid;
  current_fingerprint text;
  employee_result record;
  account_record public.time_accounts%rowtype;
  close_minutes integer;
begin
  if not app_private.is_p1_23_time_holder(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-23-period:' || p_period_id::text, 0));
  select event.close_version_id into prior_close_id from public.time_period_events event
  where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
  if found then
    if not exists (select 1 from public.time_period_events event
      where event.organization_id = p_organization_id and event.operation_id = p_operation_id
        and event.request_hash = p_request_hash) then raise exception 'operation_id_conflict'; end if;
    return prior_close_id;
  end if;
  select * into period_record from public.time_periods
  where id = p_period_id and organization_id = p_organization_id for update;
  if not found then raise exception 'period_not_found'; end if;
  if period_record.state = 'closed' then raise exception 'period_closed'; end if;
  if period_record.period_end_date >= (clock_timestamp() at time zone 'Europe/Berlin')::date then raise exception 'period_not_ended'; end if;
  select * into calculation_record from public.time_period_calculations
  where id = period_record.current_calculation_id and organization_id = p_organization_id;
  if not found then raise exception 'period_not_prepared'; end if;
  current_fingerprint := app_private.compute_p1_23_source_fingerprint(
    p_organization_id, period_record.period_start_date, period_record.period_end_date
  );
  if current_fingerprint <> calculation_record.source_fingerprint then raise exception 'stale_calculation'; end if;
  if exists (select 1 from public.time_period_findings finding
    where finding.calculation_id = calculation_record.id and finding.severity = 'close_blocked')
    then raise exception 'close_blocked_finding'; end if;
  if exists (select 1 from public.time_period_findings finding
    where finding.calculation_id = calculation_record.id and finding.severity = 'approval_required'
      and (select decision.decision from public.time_period_finding_decisions decision
        where decision.finding_id = finding.id
          and decision.organization_id = p_organization_id
        order by decision.decided_at desc, decision.id
        limit 1) is distinct from 'approved')
    then raise exception 'approval_required_finding'; end if;
  select coalesce(max(version), 0) + 1 into close_version
  from public.time_period_close_versions where period_id = p_period_id;
  insert into public.time_period_close_versions(
    id, organization_id, period_id, calculation_id, version,
    supersedes_close_version_id, source_fingerprint,
    opening_balance_total_minutes, period_delta_total_minutes,
    closing_balance_total_minutes, closed_by
  ) select close_id, p_organization_id, p_period_id, calculation_record.id,
    close_version, period_record.current_close_version_id,
    calculation_record.source_fingerprint,
    coalesce(sum(previous_balance_minutes), 0),
    coalesce(sum(period_delta_minutes), 0),
    coalesce(sum(closing_balance_minutes), 0), p_actor_id
  from public.time_period_employee_results where calculation_id = calculation_record.id;
  for employee_result in
    select * from public.time_period_employee_results
    where calculation_id = calculation_record.id order by employee_record_id
  loop
    select * into account_record from public.time_accounts
    where organization_id = p_organization_id
      and employee_record_id = employee_result.employee_record_id for update;
    if not found then raise exception 'missing_time_account'; end if;
    close_minutes := employee_result.period_delta_minutes - employee_result.account_event_minutes;
    insert into public.time_account_events(
      organization_id, account_id, employee_record_id, event_kind,
      effective_date, minutes, reason, close_version_id, operation_id,
      request_hash, created_by
    ) values (
      p_organization_id, account_record.id, employee_result.employee_record_id,
      'period_close', period_record.period_end_date, close_minutes,
      'Periodenabschluss ' || period_record.period_start_date::text,
      close_id, gen_random_uuid(), p_request_hash, p_actor_id
    );
    update public.time_accounts set
      current_balance_minutes = employee_result.closing_balance_minutes,
      last_closed_period_end_date = period_record.period_end_date,
      version = version + 1, updated_at = now()
    where id = account_record.id;
  end loop;
  update public.time_periods set state = 'closed', current_close_version_id = close_id,
    version = version + 1, updated_at = now() where id = p_period_id;
  insert into public.time_period_events(
    organization_id, period_id, event_type, calculation_id, close_version_id,
    operation_id, request_hash, actor_id, event_payload
  ) values (
    p_organization_id, p_period_id, 'closed', calculation_record.id, close_id,
    p_operation_id, p_request_hash, p_actor_id,
    jsonb_build_object('close_version', close_version)
  );
  return close_id;
end;
$$;

revoke all on function public.close_time_period_p1_23_base(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
