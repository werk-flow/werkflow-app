-- „Alle eröffnen“ opens the missing time accounts of several people with one
-- shared opening date and reason, all or nothing (werk-flow/werkflow-planning#160).
-- Each person still gets their own account and their own opening event with
-- their own balance: the function calls open_time_account once per person,
-- so the per-person record, its lock and its guards stay exactly as before.
--
-- Division of work: the server action establishes the Admin, parses every
-- balance and passes the people the Admin confirmed. The function repeats the
-- Admin check, locks every person and every month from the opening date to
-- today, and raises the action's failure code of the first refusal, so
-- nothing is opened:
--   not_authorized, reason_required, invalid_input, employee_not_found,
--   account_already_open, opening_date_locked; the opening event trigger
--   still raises period_closed for a date inside a closed month.
--
-- Closed months: an opening on or before the end of a closed month changes
-- the balance that month carried forward, so the shared date must lie after
-- the last closed month. That is the rule of correct_time_account_opening_date
-- (migration 20261030120000), with its locks in its order: the person, then
-- the months oldest first, then the period rows FOR SHARE. A close that holds
-- its period row first makes this call see 'closed'; a close that waits finds
-- a changed source fingerprint and refuses with stale_calculation.
-- open_time_account itself is unchanged.

create function public.open_time_accounts(
  p_actor_id uuid,
  p_organization_id uuid,
  p_openings jsonb,
  p_opened_on date,
  p_reason text,
  p_request_hash text
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_opening record;
  v_count integer;
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  -- Bounds the month locks below: no time account starts before 2000.
  if p_opened_on is null or p_opened_on < date '2000-01-01' then raise exception 'invalid_input'; end if;
  if jsonb_typeof(p_openings) is distinct from 'array' or jsonb_array_length(p_openings) = 0 then
    raise exception 'invalid_input';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_openings) opening
    where jsonb_typeof(opening) is distinct from 'object'
      or jsonb_typeof(opening->'employee_record_id') is distinct from 'string'
      -- CASE, because SQL may evaluate the casts of an OR before its type check.
      or case when jsonb_typeof(opening->'opening_minutes') = 'number' then
        (opening->>'opening_minutes')::numeric <> trunc((opening->>'opening_minutes')::numeric)
        or abs((opening->>'opening_minutes')::numeric) > 2147483647
      else true end
  ) then
    raise exception 'invalid_input';
  end if;
  select count(*) into v_count from jsonb_array_elements(p_openings);
  if v_count <> (
    select count(distinct opening->>'employee_record_id') from jsonb_array_elements(p_openings) opening
  ) then
    raise exception 'invalid_input';
  end if;

  -- The lock open_time_account takes per person, here for everyone first and
  -- in one order, so two calls over the same people never deadlock.
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':time_account:' || person.employee_record_id::text, 0
  ))
  from (
    select (opening->>'employee_record_id')::uuid as employee_record_id
    from jsonb_array_elements(p_openings) opening
    order by 1
  ) person;
  -- The month lock of prepare_time_period and close_time_period, for every
  -- month from the opening date to today, oldest first.
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
  ) then
    raise exception 'opening_date_locked';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_openings) opening
    where not exists (
      select 1 from public.employee_records employee
      where employee.organization_id = p_organization_id
        and employee.id = (opening->>'employee_record_id')::uuid
    )
  ) then
    raise exception 'employee_not_found';
  end if;
  if exists (
    select 1 from public.time_accounts account
    join jsonb_array_elements(p_openings) opening
      on account.employee_record_id = (opening->>'employee_record_id')::uuid
    where account.organization_id = p_organization_id
  ) then
    raise exception 'account_already_open';
  end if;

  for v_opening in
    select (opening->>'employee_record_id')::uuid as employee_record_id,
      (opening->>'opening_minutes')::integer as opening_minutes
    from jsonb_array_elements(p_openings) opening
    order by 1
  loop
    perform public.open_time_account(
      p_organization_id, v_opening.employee_record_id, v_opening.opening_minutes,
      p_opened_on, p_reason, p_actor_id, gen_random_uuid(), p_request_hash
    );
  end loop;
  return v_count;
end;
$$;

revoke all on function public.open_time_accounts(uuid, uuid, jsonb, date, text, text)
  from public, anon, authenticated;
grant execute on function public.open_time_accounts(uuid, uuid, jsonb, date, text, text)
  to service_role;
