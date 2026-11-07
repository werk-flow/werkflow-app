-- A close and a reopen check the order of an organization's periods: a month
-- closes only after every earlier month is closed and before any later one,
-- and a month reopens only while no later month is closed. Each took only the
-- advisory lock of its own month, so a close of one month and a reopen of the
-- month before could both pass their order check at the same moment. The
-- close then booked a balance on top of the one the reopen reversed.
--
-- Both now take one advisory lock per organization before the lock of their
-- month. The second of two concurrent calls waits for the first to commit,
-- and its order check, a new statement under read committed, sees the
-- result. Every caller takes the order lock first and nothing else takes it,
-- so it adds no lock cycle. The month lock stays: preparation and the opening
-- date correction serialize on it.
--
-- The signatures, the checks, the results and the grants stay as before
-- (close from 20261028130000_keep_period_close_consistent_with_concurrent_writes.sql,
-- reopen from 20260901132000_finalize_p1_23_release_invariants.sql).

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
    p_organization_id::text || ':p1-23-period-order', 0
  ));
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
  if not exists (
    select 1 from public.time_period_events event
    where event.organization_id = p_organization_id and event.operation_id = p_operation_id
  ) and exists (
    select 1
    from public.time_correction_requests request
    join public.time_correction_request_revisions revision
      on revision.request_id = request.id and revision.revision = request.current_revision
    cross join lateral jsonb_array_elements(
      coalesce(revision.proposed_snapshot -> 'facts', '[]'::jsonb)
    ) fact
    where request.organization_id = p_organization_id
      and request.status in ('submitted', 'clarification_required')
      and nullif(fact.value ->> 'timestamp', '') is not null
      and (fact.value ->> 'timestamp')::timestamptz
        >= (period_record.period_start_date::timestamp at time zone 'Europe/Berlin')
      and (fact.value ->> 'timestamp')::timestamptz
        < ((period_record.period_end_date + 1)::timestamp at time zone 'Europe/Berlin')
  ) then
    raise exception 'period_pending_corrections';
  end if;

  return public.close_time_period_p1_23_base(
    p_actor_id, p_organization_id, p_period_id, p_operation_id, p_request_hash
  );
end;
$$;

create or replace function public.reopen_time_period(
  p_actor_id uuid,
  p_organization_id uuid,
  p_period_id uuid,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  period_record public.time_periods%rowtype;
begin
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  select * into period_record from public.time_periods period
  where period.id = p_period_id and period.organization_id = p_organization_id;
  if not found then raise exception 'period_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period-order', 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || period_record.period_start_date::text, 0
  ));
  if exists (
    select 1 from public.time_periods later
    where later.organization_id = p_organization_id
      and later.period_end_date > period_record.period_end_date
      and later.state = 'closed'
  ) then
    raise exception 'period_order_conflict';
  end if;
  return public.reopen_time_period_p1_23_base(
    p_actor_id, p_organization_id, p_period_id, p_reason,
    p_operation_id, p_request_hash
  );
end;
$$;

revoke all on function public.close_time_period(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.close_time_period(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.reopen_time_period(uuid, uuid, uuid, text, uuid, text)
  to service_role;
