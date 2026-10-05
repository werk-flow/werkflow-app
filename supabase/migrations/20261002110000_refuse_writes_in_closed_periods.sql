-- A closed time period (P1-23) freezes the recorded time of its month. Until
-- now only the server actions checked that, so any other writer (a missed
-- action, a race with a concurrent close, a service-role script) could change
-- a closed month. These triggers refuse the write in the database.
--
-- Protected rows: the three sources of a period calculation, as listed by
-- app_private.compute_p1_23_source_fingerprint_base: time_entries,
-- time_sessions and time_segments. Approved corrections never rewrite these
-- rows; time_correction_applications has its own closed-period guards.
--
-- Error contract: SQLSTATE WFP01 with the message 'period_closed'.
-- isPeriodClosedError in lib/time-tracking/closed-periods.ts maps the code to
-- the action result { success: false, error: 'period_closed' }.
--
-- Business date: the Europe/Berlin date, the rule of
-- app_private.guard_time_correction_closed_period. A clock_out or break_end at
-- exactly 00:00 closes the previous day. A segment or session covers every day
-- from its start to its end, an open one its start day. An UPDATE checks the
-- old and the new row.
--
-- No bypass setting: close_time_period, reopen_time_period and the correction
-- RPCs write none of these rows, and member removal refuses a member with
-- recorded time. The one legitimate writer is the cascade of an organization
-- deletion. It is recognised by the organization row being gone, which no
-- caller can produce without deleting the organization.

create function app_private.assert_time_facts_period_open(
  p_organization_id uuid,
  p_first_date date,
  p_last_date date
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_state public.time_period_state;
begin
  -- Race-free against close_time_period, which takes the period row FOR
  -- UPDATE before it compares the source fingerprint. FOR SHARE conflicts with
  -- that lock. If the close holds it first, this statement waits, rereads the
  -- committed row and sees 'closed'. If this write holds it first, the close
  -- waits for this commit, and its fingerprint then includes the write, so it
  -- refuses with stale_calculation. A month without a period row has nothing
  -- to lock: its later close compares a fingerprint taken after this commit.
  -- Ordering by start date keeps writers that span two periods deadlock-free.
  for v_state in
    select period.state from public.time_periods period
    where period.organization_id = p_organization_id
      and period.period_start_date <= p_last_date
      and period.period_end_date >= p_first_date
    order by period.period_start_date
    for share
  loop
    if v_state = 'closed' then
      raise exception using errcode = 'WFP01', message = 'period_closed';
    end if;
  end loop;
end;
$$;

create function app_private.time_fact_days(
  p_table_name text,
  p_fact jsonb,
  out first_date date,
  out last_date date
)
language plpgsql
stable
set search_path to ''
as $$
declare
  v_start timestamp;
  v_end timestamp;
begin
  if p_table_name = 'time_entries' then
    v_start := (p_fact ->> 'timestamp')::timestamptz at time zone 'Europe/Berlin';
    first_date := v_start::date;
    if p_fact ->> 'entry_type' in ('clock_out', 'break_end') and v_start::time = time '00:00' then
      first_date := first_date - 1;
    end if;
    last_date := first_date;
    return;
  end if;
  v_start := (p_fact ->> 'started_at')::timestamptz at time zone 'Europe/Berlin';
  first_date := v_start::date;
  last_date := first_date;
  if p_fact ->> 'ended_at' is not null then
    v_end := (p_fact ->> 'ended_at')::timestamptz at time zone 'Europe/Berlin';
    last_date := greatest(
      first_date,
      v_end::date - case when v_end::time = time '00:00' then 1 else 0 end
    );
  end if;
end;
$$;

create function app_private.guard_closed_period_time_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_old_first date;
  v_old_last date;
  v_new_first date;
  v_new_last date;
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from public.organizations where id = old.organization_id)
  then
    return old;
  end if;

  if tg_op <> 'INSERT' then
    select days.first_date, days.last_date into v_old_first, v_old_last
    from app_private.time_fact_days(tg_table_name, to_jsonb(old)) days;
    perform app_private.assert_time_facts_period_open(old.organization_id, v_old_first, v_old_last);
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  select days.first_date, days.last_date into v_new_first, v_new_last
  from app_private.time_fact_days(tg_table_name, to_jsonb(new)) days;
  if tg_op = 'INSERT' then
    perform app_private.assert_time_facts_period_open(new.organization_id, v_new_first, v_new_last);
  elsif (new.organization_id, v_new_first, v_new_last)
    is distinct from (old.organization_id, v_old_first, v_old_last)
  then
    perform app_private.assert_time_facts_period_open(new.organization_id, v_new_first, v_new_last);
  end if;
  return new;
end;
$$;

-- Trigger functions and their internal steps: no role calls them directly.
revoke all on function app_private.assert_time_facts_period_open(uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function app_private.time_fact_days(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.guard_closed_period_time_write()
  from public, anon, authenticated, service_role;

create trigger guard_closed_period_write
  before insert or update or delete on public.time_entries
  for each row execute function app_private.guard_closed_period_time_write();
create trigger guard_closed_period_write
  before insert or update or delete on public.time_sessions
  for each row execute function app_private.guard_closed_period_time_write();
create trigger guard_closed_period_write
  before insert or update or delete on public.time_segments
  for each row execute function app_private.guard_closed_period_time_write();
