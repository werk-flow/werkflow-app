-- open_time_account refuses an opening date on or before the end of a closed
-- period (werk-flow/werkflow-planning#357).
--
-- The opening event trigger already refused a date inside a closed month
-- (period_closed). A date before a closed month, in a month without a period
-- of its own, was accepted: the account then started under a month whose
-- closed version never saw its opening balance. correct_time_account_opening_date
-- (migration 20261030120000) and open_time_accounts (migration 20261201090000)
-- refuse that date with opening_date_locked; the single opening now does too,
-- with their locks in their order: the person, then every month from the
-- opening date to today oldest first, then the period rows FOR SHARE. A close
-- that holds its period row first makes this call see 'closed'; a close that
-- waits finds a changed source fingerprint and refuses with stale_calculation.
--
-- open_time_accounts holds all of these locks before it calls this function
-- per person; taking them again in the same transaction does not wait.
--
-- The date lies at most ten years back, the bound of open_time_accounts
-- (opening_date_too_old), so the month locks stay at 121. Signature, owner
-- rights and grants are unchanged: only service_role executes it.

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
  if p_opened_on is null then raise exception 'invalid_input'; end if;
  if p_opened_on < ((clock_timestamp() at time zone 'Europe/Berlin')::date - interval '10 years')::date then
    raise exception 'opening_date_too_old';
  end if;
  if not exists (
    select 1 from public.employee_records employee
    where employee.id = p_employee_record_id and employee.organization_id = p_organization_id
  ) then raise exception 'employee_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || month_start::date::text, 0
  ))
  from generate_series(
    date_trunc('month', p_opened_on),
    (clock_timestamp() at time zone 'Europe/Berlin')::date,
    interval '1 month'
  ) as month_start;
  perform 1 from public.time_periods period
  where period.organization_id = p_organization_id and period.period_end_date >= p_opened_on
  order by period.period_start_date
  for share;
  if exists (
    select 1 from public.time_periods period
    where period.organization_id = p_organization_id
      and period.period_end_date >= p_opened_on
      and period.state = 'closed'
  ) then raise exception 'opening_date_locked'; end if;
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

revoke all on function public.open_time_account(uuid, uuid, integer, date, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.open_time_account(uuid, uuid, integer, date, text, uuid, uuid, text) to service_role;
