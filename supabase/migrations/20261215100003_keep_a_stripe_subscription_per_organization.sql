-- A Stripe subscription per organization (werk-flow/werkflow-planning#248,
-- epic #245) replaces the per-user `subscriptions` row that simulatePayment
-- wrote. `subscriptions` stays until a later release drops it.
--
-- One row per organization holds its Stripe customer and the state of its
-- subscription as Stripe reports it. The organization id comes first: an
-- Admin's Checkout for an existing organization names that organization, and
-- a Checkout before any organization exists reserves the id of the
-- organization its payer creates next. WerkFlow's server puts that id into
-- the Stripe customer's `werkflow_organization_id` metadata, so every signal
-- maps to it. A reservation has no organization yet, so the column carries
-- no foreign key; the row also outlives a deleted organization, as billing
-- records do.
--
-- `holds_subscription` is the one rule of what counts as subscribed. No
-- lockout in stage A: a failed payment never ends it, and a subscription
-- Stripe cancelled for a failed payment still counts as past due. Nothing
-- reads it for access; it gates only the creation of a reserved organization
-- and a second Checkout.
--
-- One payable Checkout per organization: the row holds the organization's
-- open Checkout session. A Checkout start locks the row and answers that
-- session while it stays open; only otherwise does it claim a new attempt,
-- whose number keys Stripe's idempotency, so a failed attempt never blocks
-- the next one. A second subscription that still lands is refused here
-- (`subscription_conflict`). Once fresh reads show the first still holds,
-- the row marks the second as a duplicate under its lock, in the call that
-- refuses it, and lib/subscription/record.ts refunds and cancels it. A
-- marked subscription never becomes the organization's subscription, so the
-- cancellation never hits the one the organization keeps.
--
-- No client role reaches the table or the functions. The service role reads
-- the table and writes it only through the functions below.
--
-- Prevention: Tier 1 (grants, checks, the conflict rule and the Checkout lock each in one statement),
-- Tier 2 supabase/tests/werkflow_subscriptions.sql.

create function public.werkflow_subscription_holds(p_status text, p_cancellation_reason text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select coalesce(
    p_status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
      or (p_status = 'canceled' and p_cancellation_reason = 'payment_failed'),
    false
  );
$$;

revoke all on function public.werkflow_subscription_holds(text, text) from public, anon, authenticated;
grant execute on function public.werkflow_subscription_holds(text, text) to service_role;

create table public.werkflow_subscriptions (
  organization_id uuid primary key,
  -- Who started the Checkout; the only one who may create a reserved organization.
  reserved_by uuid references auth.users (id) on delete set null,
  -- When the organization existed for this row: at once for an existing one,
  -- at its creation for a reservation. A linked row never reserves again.
  linked_at timestamptz,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]{1,250}$'),
  stripe_subscription_id text unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9_]{1,250}$'),
  -- Stripe's values, kept as Stripe names them; a value Stripe adds later is kept too.
  status text check (status ~ '^[a-z_]{1,40}$'),
  cancellation_reason text check (cancellation_reason ~ '^[a-z_]{1,60}$'),
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  -- When WerkFlow last read each subscription of the organization from Stripe,
  -- by subscription id: a read no newer than its subscription's last one changes nothing.
  read_at_by_subscription jsonb not null default '{}'::jsonb
    check (jsonb_typeof(read_at_by_subscription) = 'object'),
  -- The organization's one Checkout: its session, while a payer may still open it.
  checkout_session_id text check (checkout_session_id ~ '^cs_[A-Za-z0-9_]{1,250}$'),
  checkout_url text check (checkout_url ~ '^https://[!-~]+$' and length(checkout_url) <= 2000),
  checkout_expires_at timestamptz,
  -- Counts Checkout starts that may create a session; each one's number keys Stripe's idempotency.
  checkout_attempt integer not null default 0 check (checkout_attempt >= 0),
  -- While a start creates the session of attempt checkout_attempt, no other start creates one.
  checkout_claimed_until timestamptz,
  -- Subscriptions refused as a second one while another held: each is refunded and
  -- cancelled, and none ever becomes the organization's subscription.
  duplicate_subscription_ids text[] not null default '{}'
    check (array_to_string(duplicate_subscription_ids, ' ') ~ '^(sub_[A-Za-z0-9_]{1,250}( |$))*$'),
  holds_subscription boolean not null
    generated always as (public.werkflow_subscription_holds(status, cancellation_reason)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((stripe_subscription_id is null) = (status is null)),
  check (
    (checkout_session_id is null) = (checkout_url is null)
    and (checkout_session_id is null) = (checkout_expires_at is null)
  )
);

-- One open reservation per person: a second Checkout before the organization
-- exists reuses the first one's customer.
create unique index werkflow_subscriptions_one_open_reservation
  on public.werkflow_subscriptions (reserved_by)
  where linked_at is null;

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.werkflow_subscriptions enable row level security;

revoke all on table public.werkflow_subscriptions from public, anon, authenticated, service_role;
grant select on table public.werkflow_subscriptions to service_role;

-- Starts an organization's Checkout in one locked step. Stores the Stripe
-- customer on the first start: for an existing organization (`p_linked`) the
-- user must be its Admin; a reservation names an id no organization has, and
-- a person holds one open reservation (`reservation_refused` otherwise). A
-- later start keeps the first customer. Answers, with the row's customer:
-- 'subscribed': the subscription holds; no Checkout opens.
-- 'open': the stored session stays open at least 15 more minutes; every
--   start answers it, so parallel starts share one Checkout. A caller that
--   read it closed at Stripe (paid, or expired) names it in
--   `p_closed_session_id`, and the start goes on as if it were near expiry.
-- 'busy': another start is creating the session; nothing changes.
-- 'claimed': the caller makes the stored session, if any, unpayable, creates
--   the session of `attempt` and hands it to finish_werkflow_checkout within
--   two minutes; `session_id` is the stored session to close.
create function public.begin_werkflow_checkout(
  p_organization_id uuid,
  p_user_id uuid,
  p_linked boolean,
  p_stripe_customer_id text,
  p_closed_session_id text default null,
  out result text,
  out stripe_customer_id text,
  out attempt integer,
  out session_id text,
  out session_url text
)
language plpgsql
security definer
set search_path to ''
as $$
#variable_conflict use_column
declare
  v_row public.werkflow_subscriptions;
begin
  if p_organization_id is null or p_user_id is null or p_linked is null or p_stripe_customer_id is null then
    raise exception 'invalid_input';
  end if;
  if p_linked and not exists (
    select 1 from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_user_id
      and membership.role = 'admin'
  ) then
    raise exception 'not_admin';
  end if;
  if not p_linked and exists (select 1 from public.organizations organization where organization.id = p_organization_id) then
    raise exception 'invalid_input';
  end if;

  insert into public.werkflow_subscriptions (organization_id, reserved_by, linked_at, stripe_customer_id)
  values (p_organization_id, p_user_id, case when p_linked then now() end, p_stripe_customer_id)
  on conflict do nothing;

  select * into v_row from public.werkflow_subscriptions subscription
  where subscription.organization_id = p_organization_id
    and (subscription.linked_at is not null) = p_linked
    and (p_linked or subscription.reserved_by = p_user_id)
  for update;
  if not found then
    raise exception 'reservation_refused';
  end if;

  stripe_customer_id := v_row.stripe_customer_id;
  if v_row.holds_subscription then
    result := 'subscribed';
  elsif v_row.checkout_expires_at > now() + interval '15 minutes'
    and v_row.checkout_session_id is distinct from p_closed_session_id
  then
    result := 'open';
    session_id := v_row.checkout_session_id;
    session_url := v_row.checkout_url;
  elsif v_row.checkout_claimed_until > now() then
    result := 'busy';
  else
    update public.werkflow_subscriptions subscription
    set checkout_attempt = subscription.checkout_attempt + 1,
        checkout_claimed_until = now() + interval '2 minutes',
        updated_at = now()
    where subscription.organization_id = p_organization_id
    returning * into v_row;
    result := 'claimed';
    session_id := v_row.checkout_session_id;
  end if;
  attempt := v_row.checkout_attempt;
end;
$$;

-- Ends the claim of a Checkout attempt. With a session, stores it as the
-- organization's one Checkout; without one (the attempt failed), only the
-- claim ends and the stored session stays, so the next start closes it
-- again. Answers false and changes nothing when the attempt no longer holds
-- the claim: its session is then never handed to a payer.
create function public.finish_werkflow_checkout(
  p_organization_id uuid,
  p_attempt integer,
  p_session_id text default null,
  p_session_url text default null,
  p_expires_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_organization_id is null or p_attempt is null
    or (p_session_id is null) <> (p_session_url is null)
    or (p_session_id is null) <> (p_expires_at is null)
  then
    raise exception 'invalid_input';
  end if;
  update public.werkflow_subscriptions subscription
  set checkout_session_id = coalesce(p_session_id, subscription.checkout_session_id),
      checkout_url = coalesce(p_session_url, subscription.checkout_url),
      checkout_expires_at = coalesce(p_expires_at, subscription.checkout_expires_at),
      checkout_claimed_until = null,
      updated_at = now()
  where subscription.organization_id = p_organization_id
    and subscription.checkout_attempt = p_attempt
    and subscription.checkout_claimed_until > now();
  return found;
end;
$$;

-- Records the state of a subscription as Stripe reports it on a re-read.
-- The organization and the customer come from the Stripe customer; a row of
-- another customer refuses. Read times order the reads of each subscription
-- on their own: a read no newer than that subscription's last one changes
-- nothing, so a slow handler never brings back an older state, also of a
-- subscription the row does not follow. Every newer read is noted. Another
-- subscription replaces the stored one only when it holds, the stored one
-- does not, and it is not marked as a duplicate. While the stored one holds,
-- the call refuses (`subscription_conflict`); with `p_refuse_as_duplicate`,
-- which the caller passes once fresh reads of both still found them
-- holding, it marks the newcomer as a duplicate instead. Another
-- subscription that does not hold changes only its read time. Answers
-- 'recorded', 'ignored', or 'duplicate': the subscription is marked, and
-- the caller refunds and cancels it.
create function public.record_werkflow_subscription_state(
  p_organization_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_cancel_at_period_end boolean,
  p_read_at timestamptz,
  p_cancellation_reason text default null,
  p_current_period_end timestamptz default null,
  p_refuse_as_duplicate boolean default false
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.werkflow_subscriptions;
begin
  if p_organization_id is null or p_stripe_customer_id is null or p_stripe_subscription_id is null
    or p_status is null or p_cancel_at_period_end is null or p_read_at is null
    or p_refuse_as_duplicate is null
  then
    raise exception 'invalid_input';
  end if;
  select * into v_row from public.werkflow_subscriptions subscription
  where subscription.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'subscription_row_missing';
  end if;
  if v_row.stripe_customer_id <> p_stripe_customer_id then
    raise exception 'subscription_customer_mismatch';
  end if;
  if p_read_at <= (v_row.read_at_by_subscription ->> p_stripe_subscription_id)::timestamptz then
    return 'ignored';
  end if;
  update public.werkflow_subscriptions subscription
  set read_at_by_subscription = subscription.read_at_by_subscription
        || jsonb_build_object(p_stripe_subscription_id, p_read_at)
  where subscription.organization_id = p_organization_id;

  if v_row.stripe_subscription_id <> p_stripe_subscription_id then
    if not public.werkflow_subscription_holds(p_status, p_cancellation_reason) then
      return 'ignored';
    end if;
    if p_stripe_subscription_id = any (v_row.duplicate_subscription_ids) then
      return 'duplicate';
    end if;
    if v_row.holds_subscription then
      if not p_refuse_as_duplicate then
        raise exception 'subscription_conflict';
      end if;
      update public.werkflow_subscriptions subscription
      set duplicate_subscription_ids = subscription.duplicate_subscription_ids || p_stripe_subscription_id,
          updated_at = now()
      where subscription.organization_id = p_organization_id;
      return 'duplicate';
    end if;
  end if;

  update public.werkflow_subscriptions subscription
  set stripe_subscription_id = p_stripe_subscription_id,
      status = p_status,
      cancellation_reason = p_cancellation_reason,
      cancel_at_period_end = p_cancel_at_period_end,
      current_period_end = p_current_period_end,
      updated_at = now()
  where subscription.organization_id = p_organization_id;
  return 'recorded';
end;
$$;

-- The body of create_organization_with_defaults, now with the id given, so a
-- reserved organization takes the id its Stripe customer names.
create function public.create_organization_with_id(
  p_organization_id uuid,
  p_admin_id uuid,
  p_name text,
  p_unique_code text
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_created_at timestamptz;
  v_constraint text;
begin
  begin
    insert into public.organizations (id, name, admin_id, unique_code)
    values (p_organization_id, p_name, p_admin_id, p_unique_code)
    returning created_at into v_created_at;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'organizations_admin_id_normalized_name_key' then
      raise exception 'name_taken';
    end if;
    raise;
  end;

  -- The default break policy and its first history entry, with the nine-hour
  -- step on. effectiveFrom uses the ISO form with Z that the history parser in
  -- lib/time-tracking/settings.ts accepts.
  insert into public.organization_settings (
    organization_id, break_mode, auto_break_threshold_minutes, auto_break_duration_minutes,
    auto_break_second_threshold_minutes, auto_break_second_duration_minutes, break_policy_history
  ) values (
    p_organization_id, 'manual', 360, 30, 540, 45,
    jsonb_build_array(jsonb_build_object(
      'breakMode', 'manual',
      'autoBreakThresholdMinutes', 360,
      'autoBreakDurationMinutes', 30,
      'secondStep', jsonb_build_object('thresholdMinutes', 540, 'durationMinutes', 45),
      'effectiveFrom', to_char(v_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ))
  );

  if not exists (
    select 1 from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_admin_id
      and membership.role = 'admin'
  ) then
    raise exception 'member_creation_failed';
  end if;

  return p_organization_id;
end;
$$;

revoke all on function public.create_organization_with_id(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_organization_with_id(uuid, uuid, text, text) to service_role;

-- Same signature and behavior for the previous release; the body moved above.
create or replace function public.create_organization_with_defaults(
  p_admin_id uuid,
  p_name text,
  p_unique_code text
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
begin
  return public.create_organization_with_id(gen_random_uuid(), p_admin_id, p_name, p_unique_code);
end;
$$;

-- Creates the organization the admin's own open reservation names, with the
-- reserved id, and links the row, in one transaction. Only the payer creates
-- it, once, and only while the subscription holds. Refusals:
-- subscription_required, and create_organization_with_id's name_taken and
-- member_creation_failed.
create function public.create_organization_from_subscription(
  p_admin_id uuid,
  p_name text,
  p_unique_code text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.werkflow_subscriptions;
begin
  select * into v_row from public.werkflow_subscriptions subscription
  where subscription.reserved_by = p_admin_id
    and subscription.linked_at is null
  for update;
  if not found or not v_row.holds_subscription then
    raise exception 'subscription_required';
  end if;

  perform public.create_organization_with_id(v_row.organization_id, p_admin_id, p_name, p_unique_code);
  update public.werkflow_subscriptions subscription
  set linked_at = now(), updated_at = now()
  where subscription.organization_id = v_row.organization_id;
  return v_row.organization_id;
end;
$$;

revoke all on function public.begin_werkflow_checkout(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_werkflow_checkout(uuid, uuid, boolean, text, text) to service_role;
revoke all on function public.finish_werkflow_checkout(uuid, integer, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finish_werkflow_checkout(uuid, integer, text, text, timestamptz) to service_role;
revoke all on function public.record_werkflow_subscription_state(uuid, text, text, text, boolean, timestamptz, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.record_werkflow_subscription_state(uuid, text, text, text, boolean, timestamptz, text, timestamptz, boolean)
  to service_role;
revoke all on function public.create_organization_from_subscription(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_organization_from_subscription(uuid, text, text) to service_role;
