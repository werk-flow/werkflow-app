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
-- No client role reaches the table or the functions. The service role reads
-- the table and writes it only through the functions below.
--
-- Prevention: Tier 1 (grants, checks, the conflict rule in one statement),
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
  holds_subscription boolean not null
    generated always as (public.werkflow_subscription_holds(status, cancellation_reason)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((stripe_subscription_id is null) = (status is null))
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

-- Stores the Stripe customer of an organization's Checkout and answers the
-- customer the row holds. For an existing organization (`p_linked`) the user
-- must be its Admin; a reservation names an id no organization has. Answers
-- null when the user already holds another open reservation. A second call
-- for the same organization keeps the first customer.
create function public.reserve_werkflow_subscription(
  p_organization_id uuid,
  p_user_id uuid,
  p_linked boolean,
  p_stripe_customer_id text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_customer text;
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

  select subscription.stripe_customer_id into v_customer
  from public.werkflow_subscriptions subscription
  where subscription.organization_id = p_organization_id
    and (subscription.linked_at is not null) = p_linked
    and (p_linked or subscription.reserved_by = p_user_id);
  return v_customer;
end;
$$;

-- Records the state of a subscription as Stripe reports it on a re-read.
-- The organization and the customer come from the Stripe customer; a row of
-- another customer refuses. A second subscription of one organization
-- replaces the stored one only when the stored one no longer holds; while it
-- holds, the call refuses, so a double charge reaches a person. A signal of a
-- subscription the row no longer follows, and that does not hold, changes
-- nothing. Answers 'recorded' or 'ignored'.
create function public.record_werkflow_subscription_state(
  p_organization_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_cancel_at_period_end boolean,
  p_cancellation_reason text default null,
  p_current_period_end timestamptz default null
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
    or p_status is null or p_cancel_at_period_end is null
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
  if v_row.stripe_subscription_id is not null and v_row.stripe_subscription_id <> p_stripe_subscription_id then
    if not public.werkflow_subscription_holds(p_status, p_cancellation_reason) then
      return 'ignored';
    end if;
    if v_row.holds_subscription then
      raise exception 'subscription_conflict';
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

revoke all on function public.reserve_werkflow_subscription(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.reserve_werkflow_subscription(uuid, uuid, boolean, text) to service_role;
revoke all on function public.record_werkflow_subscription_state(uuid, text, text, text, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_werkflow_subscription_state(uuid, text, text, text, boolean, text, timestamptz)
  to service_role;
revoke all on function public.create_organization_from_subscription(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_organization_from_subscription(uuid, text, text) to service_role;
