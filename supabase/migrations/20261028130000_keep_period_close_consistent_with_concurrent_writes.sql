-- Two gaps between a period close and writes that run at the same time.
--
-- 1. assert_p1_23_period_open guards account events (an approved adjustment,
--    an opening balance) and correction applications. It read the period
--    state without a lock, so a write could pass the check while a close of
--    the same month ran. The close then either overwrote the write's minutes
--    in the balance or left the write in a closed month outside the export.
--    The guard now locks the period rows of its day FOR SHARE, exactly like
--    app_private.assert_time_facts_period_open (migration
--    20261002110000_refuse_writes_in_closed_periods.sql), whose comment owns
--    the argument: close_time_period takes the period row FOR UPDATE before
--    it compares the source fingerprint, and the fingerprint covers account
--    events and correction applications. The rows are locked whatever their
--    state; a filter on 'closed' would skip the row a running close is about
--    to close.
--
-- 2. close_time_period trusted the preparation's pending_correction finding.
--    The server computes the findings, and a correction request submitted
--    while it read its sources was missing from them. The close now refuses
--    with 'period_pending_corrections' while a submitted or returned request
--    proposes a time inside the period, the rule of the pending_correction
--    finding in lib/time-accounts/period-preparation.ts. A request submitted
--    after this check meets the closed period when it is applied: its
--    application passes the guard above. A replay of a completed close skips
--    the check and returns its result from the base function.
--
-- The signatures, the error messages of the guard and the grants stay as
-- before.

create or replace function app_private.assert_p1_23_period_open(
  p_organization_id uuid,
  p_effective_date date
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_state public.time_period_state;
begin
  if p_organization_id is null or p_effective_date is null then
    raise exception 'invalid_effective_date';
  end if;
  for v_state in
    select period.state from public.time_periods period
    where period.organization_id = p_organization_id
      and p_effective_date between period.period_start_date and period.period_end_date
    order by period.period_start_date
    for share
  loop
    if v_state = 'closed' then
      raise exception 'period_closed';
    end if;
  end loop;
end;
$$;

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

revoke all on function public.close_time_period(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.close_time_period(uuid, uuid, uuid, uuid, text)
  to service_role;
