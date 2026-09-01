-- Keep the account root in sync with opening balances and approved adjustments,
-- and preserve the preceding closed-period marker when a later period is reopened.

create or replace function public.open_time_account(
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_opening_minutes integer,
  p_opened_on date,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  result_account_id uuid;
  existing_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':time_account:' || p_employee_record_id::text, 0));
  select account_id, request_hash into result_account_id, existing_hash
  from public.time_account_events
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then
    if existing_hash <> p_request_hash then raise exception 'operation_id_conflict'; end if;
    return result_account_id;
  end if;
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then raise exception 'not_authorized'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  if not exists (
    select 1 from public.employee_records employee
    where employee.id = p_employee_record_id and employee.organization_id = p_organization_id
  ) then raise exception 'employee_not_found'; end if;
  insert into public.time_accounts(
    organization_id, employee_record_id, opened_on, opened_by, current_balance_minutes
  ) values (
    p_organization_id, p_employee_record_id, p_opened_on, p_actor_id, p_opening_minutes
  ) returning id into result_account_id;
  insert into public.time_account_events(
    organization_id, account_id, employee_record_id, event_kind, effective_date,
    minutes, reason, operation_id, request_hash, created_by
  ) values (
    p_organization_id, result_account_id, p_employee_record_id, 'opening_balance', p_opened_on,
    p_opening_minutes, p_reason, p_operation_id, p_request_hash, p_actor_id
  );
  return result_account_id;
end;
$$;

create or replace function public.decide_time_account_adjustment(
  p_organization_id uuid,
  p_request_id uuid,
  p_expected_version bigint,
  p_decision public.time_period_finding_decision,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_record public.time_account_adjustment_requests;
  prior_event_id uuid;
  event_kind public.time_account_event_kind;
begin
  select request_id into prior_event_id from public.time_account_adjustment_events
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then return prior_event_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':adjustment:' || p_request_id::text, 0));
  select * into request_record from public.time_account_adjustment_requests
  where id = p_request_id and organization_id = p_organization_id for update;
  if request_record.id is null then raise exception 'request_not_found'; end if;
  if request_record.version <> p_expected_version then raise exception 'stale_version'; end if;
  if request_record.status <> 'submitted' then raise exception 'request_not_pending'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;
  if not app_private.can_p1_23_approve_employee(p_organization_id, p_actor_id, request_record.employee_record_id) then
    raise exception 'not_responsible_or_self_approval';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  update public.time_account_adjustment_requests set
    status = case when p_decision = 'approved' then 'approved'::public.time_account_request_status else 'rejected'::public.time_account_request_status end,
    version = version + 1, decided_by = p_actor_id, decision_reason = p_reason, decided_at = clock_timestamp()
  where id = p_request_id;
  insert into public.time_account_adjustment_events(
    organization_id, request_id, event_type, actor_id, operation_id, reason,
    responsibility_snapshot
  ) values (
    p_organization_id, p_request_id, p_decision::text, p_actor_id, p_operation_id, p_reason,
    jsonb_build_object('responsibility', 'time_approval', 'actorId', p_actor_id)
  );
  if p_decision = 'approved' then
    event_kind := request_record.adjustment_kind::text::public.time_account_event_kind;
    perform app_private.assert_p1_23_period_open(p_organization_id, request_record.effective_date);
    insert into public.time_account_events(
      organization_id, account_id, employee_record_id, event_kind, effective_date,
      minutes, reason, adjustment_request_id, operation_id, request_hash, created_by
    ) values (
      p_organization_id, request_record.account_id, request_record.employee_record_id,
      event_kind, request_record.effective_date, request_record.minutes, request_record.reason,
      request_record.id, gen_random_uuid(), request_record.request_hash, p_actor_id
    );
  end if;
  update public.time_accounts set
    current_balance_minutes = current_balance_minutes + case when p_decision = 'approved' then request_record.minutes else 0 end,
    version = version + 1,
    updated_at = now()
  where id = request_record.account_id;
  return p_request_id;
end;
$$;

create or replace function public.reopen_time_period(
  p_actor_id uuid, p_organization_id uuid, p_period_id uuid,
  p_reason text, p_operation_id uuid, p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
  close_record public.time_period_close_versions%rowtype;
  close_event record;
  reversal_id uuid;
  account_record public.time_accounts%rowtype;
  previous_closed_period_end date;
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':p1-23-period:' || p_period_id::text, 0));
  select event.close_version_id into reversal_id from public.time_period_events event
  where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
  if found then
    if not exists (
      select 1 from public.time_period_events event
      where event.organization_id = p_organization_id
        and event.operation_id = p_operation_id
        and event.request_hash = p_request_hash
    ) then raise exception 'operation_id_conflict'; end if;
    return reversal_id;
  end if;
  select * into period_record from public.time_periods
  where id = p_period_id and organization_id = p_organization_id for update;
  if not found or period_record.state <> 'closed' then raise exception 'period_not_closed'; end if;
  select * into close_record from public.time_period_close_versions
  where id = period_record.current_close_version_id;
  select max(prior_period.period_end_date) into previous_closed_period_end
  from public.time_periods prior_period
  where prior_period.organization_id = p_organization_id
    and prior_period.id <> p_period_id
    and prior_period.state = 'closed'
    and prior_period.period_end_date < period_record.period_end_date;
  for close_event in select * from public.time_account_events
    where close_version_id = close_record.id and event_kind = 'period_close' loop
    select * into account_record from public.time_accounts where id = close_event.account_id for update;
    reversal_id := gen_random_uuid();
    insert into public.time_account_events(
      id, organization_id, account_id, employee_record_id, event_kind, effective_date,
      minutes, reason, close_version_id, reverses_event_id, operation_id, request_hash, created_by
    ) values (
      reversal_id, p_organization_id, close_event.account_id, close_event.employee_record_id,
      'period_reopen_reversal', period_record.period_end_date, -close_event.minutes, p_reason,
      close_record.id, close_event.id, gen_random_uuid(), p_request_hash, p_actor_id
    );
    update public.time_accounts set
      current_balance_minutes = current_balance_minutes - close_event.minutes,
      last_closed_period_end_date = previous_closed_period_end,
      version = version + 1,
      updated_at = now()
    where id = account_record.id;
  end loop;
  update public.time_periods set state = 'reopened', version = version + 1, updated_at = now()
  where id = p_period_id;
  insert into public.time_period_events(
    organization_id, period_id, event_type, calculation_id, close_version_id,
    operation_id, request_hash, actor_id, reason
  ) values (
    p_organization_id, p_period_id, 'reopened', period_record.current_calculation_id,
    close_record.id, p_operation_id, p_request_hash, p_actor_id, p_reason
  );
  return close_record.id;
end;
$$;

revoke all on function public.open_time_account(uuid, uuid, integer, date, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.decide_time_account_adjustment(uuid, uuid, bigint, public.time_period_finding_decision, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.open_time_account(uuid, uuid, integer, date, text, uuid, uuid, text) to service_role;
grant execute on function public.decide_time_account_adjustment(uuid, uuid, bigint, public.time_period_finding_decision, text, uuid, uuid) to service_role;
grant execute on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text) to service_role;
