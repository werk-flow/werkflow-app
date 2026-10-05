-- A closed period refuses every write to its time facts (migration
-- 20261002110000_refuse_writes_in_closed_periods.sql). A session that began
-- in the period and was still open at the close could then never end: the
-- clock-out rewrites a row whose start day lies in the closed month. This
-- replacement makes that state unreachable. The close refuses with
-- 'period_open_sessions' while any session that started before the end of
-- the period has no end.
--
-- The check does not trust the findings of the preparation: the server
-- computes those, and a session can open between preparation and close.
--
-- Race: the period row is locked FOR UPDATE before the sessions are read.
-- Every insert or update of a session takes that row FOR SHARE through the
-- closed-period trigger. A session write that holds the row first makes this
-- close wait for its commit, and the read below then sees it. A session write
-- that comes after waits for the close and then finds the period closed. A
-- session that started before an earlier period is covered too: the earlier
-- close was refused while it stayed open, and this check repeats it.
--
-- The signature, the result and the grants stay as before.

create or replace function public.close_time_period(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  period_record public.time_periods%rowtype;
begin
  if not app_private.is_p1_23_time_holder(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  select * into period_record from public.time_periods period
  where period.id = p_period_id and period.organization_id = p_organization_id;
  if not found then raise exception 'period_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || period_record.period_start_date::text, 0
  ));
  if exists (
    select 1 from public.time_periods earlier
    where earlier.organization_id = p_organization_id
      and earlier.period_end_date < period_record.period_end_date
      and earlier.state <> 'closed'
  ) or exists (
    select 1 from public.time_periods later
    where later.organization_id = p_organization_id
      and later.period_end_date > period_record.period_end_date
      and later.state = 'closed'
  ) then
    raise exception 'period_order_conflict';
  end if;

  perform 1 from public.time_periods period
  where period.id = p_period_id and period.organization_id = p_organization_id
  for update;
  -- A replay of a completed close returns its result from the base function.
  -- No session of the period can be open then: this check refused the close
  -- while one was, and the closed period refuses a new one.
  if exists (
    select 1 from public.time_sessions session
    where session.organization_id = p_organization_id
      and session.ended_at is null
      and session.started_at
        < ((period_record.period_end_date + 1)::timestamp at time zone 'Europe/Berlin')
  ) then
    raise exception 'period_open_sessions';
  end if;

  return public.close_time_period_p1_23_base(
    p_actor_id, p_organization_id, p_period_id, p_operation_id, p_request_hash
  );
end;
$$;

revoke all on function public.close_time_period(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.close_time_period(uuid, uuid, uuid, uuid, text)
  to service_role;
