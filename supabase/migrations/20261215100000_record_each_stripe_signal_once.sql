-- Stripe's signals to WerkFlow's own billing (werk-flow/werkflow-planning#250,
-- epic #245). app/api/stripe/webhook/route.ts verifies a signal's signature,
-- then records and claims its event id here in one call, hands the event to its
-- family's handler, and settles the row: handled, ignored (a type no family
-- takes) or failed (the claim ends, the failure code stays, and Stripe's next
-- delivery claims it again). A settled event is never claimed again, so a
-- replayed signal changes nothing. Two deliveries of one event never run their
-- handler at the same time: a claim holds the row for ten minutes, longer than
-- the route may run. Each claim is one attempt, numbered by `attempts`, and
-- only that attempt settles the row, while its claim holds: an attempt that
-- outlived its claim, or whose event a later delivery claimed, settles nothing.
--
-- The row holds no payload and no personal data: the event id, its type,
-- Stripe's creation time and the delivery state. It belongs to no
-- organization; a handler finds the organization from the Stripe object.
--
-- No client role reaches the table or the functions. The service role reads
-- the table and writes it only through the two functions.
--
-- Prevention: Tier 1 (grants, the claim in one statement, the checks), Tier 2
-- supabase/tests/werkflow_billing_signals.sql.

create table public.werkflow_billing_signals (
  stripe_event_id text primary key check (stripe_event_id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
  event_type text not null check (event_type ~ '^[a-z0-9_.]{1,120}$'),
  stripe_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending', 'handled', 'ignored')),
  settled_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  claimed_until timestamptz,
  last_failure_code text check (last_failure_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  check ((state = 'pending') = (settled_at is null)),
  check (state = 'pending' or claimed_until is null)
);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.werkflow_billing_signals enable row level security;

revoke all on table public.werkflow_billing_signals from public, anon, authenticated, service_role;
grant select on table public.werkflow_billing_signals to service_role;

-- Records the event on its first delivery and claims it for one attempt.
-- 'claimed': the caller runs the handler and then settles the row with the
-- returned attempt number.
-- 'settled': handled or ignored before; the caller answers success and does nothing.
-- 'busy': another delivery holds the claim; the caller answers a retryable failure.
-- `attempt` is the row's attempt count; only a claim's caller uses it.
-- A replay of a settled event and a busy one change no column.
create or replace function public.claim_werkflow_billing_signal(
  p_stripe_event_id text,
  p_event_type text,
  p_stripe_created_at timestamptz
)
returns table (result text, attempt integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_state text;
  v_attempts integer;
begin
  insert into public.werkflow_billing_signals as signal (
    stripe_event_id, event_type, stripe_created_at, attempts, claimed_until
  ) values (
    p_stripe_event_id, p_event_type, p_stripe_created_at, 1, now() + interval '10 minutes'
  )
  on conflict (stripe_event_id) do update
    set attempts = signal.attempts + 1,
        claimed_until = now() + interval '10 minutes'
    where signal.state = 'pending'
      and (signal.claimed_until is null or signal.claimed_until <= now())
  returning signal.attempts into v_attempts;

  if found then
    return query select 'claimed'::text, v_attempts;
    return;
  end if;

  select signal.state, signal.attempts into v_state, v_attempts
  from public.werkflow_billing_signals signal
  where signal.stripe_event_id = p_stripe_event_id;

  return query select case when v_state = 'pending' then 'busy' else 'settled' end, v_attempts;
end;
$$;

-- Ends the claim of one attempt. 'handled' and 'ignored' settle the row for
-- good; 'failed' releases the claim and keeps the failure code for the alarm.
-- Settles only a pending row whose current attempt is p_attempt and whose
-- claim still holds. A stale call (a settled event, an expired claim, or one a
-- later delivery took) changes nothing and answers false.
create or replace function public.settle_werkflow_billing_signal(
  p_stripe_event_id text,
  p_attempt integer,
  p_outcome text,
  p_failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_outcome is null or p_outcome not in ('handled', 'ignored', 'failed') then
    raise exception 'unknown signal outcome' using errcode = '22023';
  end if;
  if (p_outcome = 'failed') is distinct from (p_failure_code is not null) then
    raise exception 'a failure code belongs to a failed attempt only' using errcode = '22023';
  end if;

  update public.werkflow_billing_signals signal
  set state = case when p_outcome = 'failed' then 'pending' else p_outcome end,
      settled_at = case when p_outcome = 'failed' then null else now() end,
      claimed_until = null,
      last_failure_code = case when p_outcome = 'failed' then p_failure_code else signal.last_failure_code end
  where signal.stripe_event_id = p_stripe_event_id
    and signal.state = 'pending'
    and signal.attempts = p_attempt
    and signal.claimed_until > now();

  return found;
end;
$$;

revoke all on function public.claim_werkflow_billing_signal(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.settle_werkflow_billing_signal(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.claim_werkflow_billing_signal(text, text, timestamptz) to service_role;
grant execute on function public.settle_werkflow_billing_signal(text, integer, text, text) to service_role;
