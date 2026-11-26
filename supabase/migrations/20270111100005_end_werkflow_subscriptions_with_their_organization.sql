-- Gaps A3 left in the Stripe subscription per organization
-- (werk-flow/werkflow-planning#495, epic #245):
--
-- 1. A subscription Stripe still bills (`runs_subscription`) is not the same
--    as one that holds (`holds_subscription`). Stripe ends a subscription
--    whose first SEPA debit failed; it still holds, since a failed payment
--    never ends access in stage A, but it no longer runs. Only a running
--    subscription now blocks a new Checkout or refuses a second subscription,
--    so the Admin can start again after a failed first debit, and the new
--    subscription replaces the ended one.
-- 2. A subscription whose organization is gone never runs on. The deleting
--    action cancels it at Stripe first (lib/subscription/end.ts); a
--    subscription that still lands for a deleted organization, or for the
--    reservation of a deleted account, is marked a duplicate, so the backstop
--    refunds and cancels it.
-- 3. The duplicate cleanup is resumable. A marked duplicate answers
--    'duplicate' until settle_werkflow_duplicate_subscription records its
--    cleanup done, even after it was cancelled outside WerkFlow, so a refund
--    that failed to start is issued on the next delivery.
-- 4. A refund of a duplicate that Stripe reports failed is recorded against
--    the duplicate and its payment (record_werkflow_refund_failure), and the
--    mail ledger takes the two new alarms.
--
-- Prevention: Tier 1 (the generated column, the checks and the rules each in
-- one statement), Tier 2 supabase/tests/werkflow_subscriptions.sql.

create function public.werkflow_subscription_runs(p_status text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select coalesce(p_status in ('active', 'trialing', 'past_due', 'unpaid', 'paused'), false);
$$;

revoke all on function public.werkflow_subscription_runs(text) from public, anon, authenticated;
grant execute on function public.werkflow_subscription_runs(text) to service_role;

alter table public.werkflow_subscriptions
  add column runs_subscription boolean not null
    generated always as (public.werkflow_subscription_runs(status)) stored,
  -- Marked duplicates whose refunds and cancellation are done; a marked one not in here is outstanding.
  add column settled_duplicate_subscription_ids text[] not null default '{}',
  -- Each refund of a duplicate that Stripe reported failed: {refund, subscription, payment_intent}.
  add column failed_duplicate_refunds jsonb not null default '[]'::jsonb;

-- @destructive: after release 55088f06: no earlier build writes the column this checks, and its default passes it
alter table public.werkflow_subscriptions
  add constraint werkflow_subscriptions_settled_duplicates_check check (
    array_to_string(settled_duplicate_subscription_ids, ' ') ~ '^(sub_[A-Za-z0-9_]{1,250}( |$))*$'
    and settled_duplicate_subscription_ids <@ duplicate_subscription_ids
  ) not valid;

-- @destructive: after release 55088f06: no earlier build writes the column this checks, and its default passes it
alter table public.werkflow_subscriptions
  add constraint werkflow_subscriptions_failed_refunds_check check (
    jsonb_typeof(failed_duplicate_refunds) = 'array'
  ) not valid;

-- @destructive: after release 55088f06: the deployed build never writes werkflow_billing_mails, and the new rule keeps every kind the old one took
alter table public.werkflow_billing_mails drop constraint werkflow_billing_mails_kind_check;

-- The list holds every kind on main (20261223100004, 20261221100009, 20270111100004) and this PR's two alarms.
-- @destructive: after release 55088f06: the deployed build writes no werkflow_billing_mails row, and the rule takes every kind the old one took
alter table public.werkflow_billing_mails add constraint werkflow_billing_mails_kind_check check (kind in (
  'payment_failed', 'card_problem', 'mandate_inactive', 'debit_notice', 'invoice', 'receipt', 'refund',
  'alarm.debit_failed', 'alarm.debit_reversed', 'alarm.mandate_inactive',
  'alarm.mail_failed', 'alarm.invoice_check_failed', 'alarm.invoice_undelivered',
  'alarm.debit_notice_late', 'alarm.mail_undelivered', 'alarm.signals_quiet',
  'alarm.reconciliation_missed', 'alarm.mail_bounced',
  'alarm.duplicate_subscription_cancelled', 'alarm.refund_failed'
)) not valid;

-- As 20261218100003, except that only a running subscription answers
-- 'subscribed': after a failed first debit the Admin starts a new Checkout.
create or replace function public.begin_werkflow_checkout(
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
  if v_row.runs_subscription then
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

-- As 20261218100003, with three changes:
-- - A marked duplicate answers 'duplicate' until its cleanup is settled,
--   whatever its status, so a cleanup cut short resumes; once settled it
--   answers 'ignored' and still never becomes the organization's.
-- - A running subscription of a deleted organization, or of a reservation
--   whose account was deleted, is marked a duplicate: nobody uses it.
-- - Only a running subscription refuses or replaces another: one Stripe
--   ended after a failed first debit gives way to its restart.
create or replace function public.record_werkflow_subscription_state(
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
  v_owner_gone boolean;
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

  if p_stripe_subscription_id = any (v_row.duplicate_subscription_ids) then
    return case when p_stripe_subscription_id = any (v_row.settled_duplicate_subscription_ids)
      then 'ignored' else 'duplicate' end;
  end if;

  v_owner_gone := case
    when v_row.linked_at is null then v_row.reserved_by is null
    else not exists (select 1 from public.organizations organization where organization.id = p_organization_id)
  end;
  if v_owner_gone and public.werkflow_subscription_runs(p_status) then
    update public.werkflow_subscriptions subscription
    set duplicate_subscription_ids = subscription.duplicate_subscription_ids || p_stripe_subscription_id,
        updated_at = now()
    where subscription.organization_id = p_organization_id;
    return 'duplicate';
  end if;

  if v_row.stripe_subscription_id <> p_stripe_subscription_id then
    if not public.werkflow_subscription_runs(p_status) then
      return 'ignored';
    end if;
    if v_row.runs_subscription then
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

-- Records that a marked duplicate is refunded and cancelled; from then on its
-- signals answer 'ignored'. Idempotent. Refuses a subscription the
-- organization's row did not mark (`duplicate_unknown`).
create function public.settle_werkflow_duplicate_subscription(
  p_organization_id uuid,
  p_stripe_subscription_id text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_organization_id is null or p_stripe_subscription_id is null then
    raise exception 'invalid_input';
  end if;
  update public.werkflow_subscriptions subscription
  set settled_duplicate_subscription_ids = case
        when p_stripe_subscription_id = any (subscription.settled_duplicate_subscription_ids)
          then subscription.settled_duplicate_subscription_ids
        else subscription.settled_duplicate_subscription_ids || p_stripe_subscription_id
      end,
      updated_at = now()
  where subscription.organization_id = p_organization_id
    and p_stripe_subscription_id = any (subscription.duplicate_subscription_ids);
  if not found then
    raise exception 'duplicate_unknown';
  end if;
end;
$$;

-- Records a refund of a marked duplicate that Stripe reported failed, against
-- the duplicate and its payment. Answers true when this call recorded it,
-- false when it was recorded before. Refuses a subscription the
-- organization's row did not mark (`duplicate_unknown`).
create function public.record_werkflow_refund_failure(
  p_organization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_refund_id text,
  p_stripe_payment_intent_id text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.werkflow_subscriptions;
begin
  if p_organization_id is null or p_stripe_subscription_id is null
    or p_stripe_refund_id !~ '^re_[A-Za-z0-9_]{1,250}$'
    or p_stripe_payment_intent_id !~ '^pi_[A-Za-z0-9_]{1,250}$'
  then
    raise exception 'invalid_input';
  end if;
  select * into v_row from public.werkflow_subscriptions subscription
  where subscription.organization_id = p_organization_id
    and p_stripe_subscription_id = any (subscription.duplicate_subscription_ids)
  for update;
  if not found then
    raise exception 'duplicate_unknown';
  end if;
  if v_row.failed_duplicate_refunds @> jsonb_build_array(jsonb_build_object('refund', p_stripe_refund_id)) then
    return false;
  end if;
  update public.werkflow_subscriptions subscription
  set failed_duplicate_refunds = subscription.failed_duplicate_refunds || jsonb_build_array(jsonb_build_object(
        'refund', p_stripe_refund_id,
        'subscription', p_stripe_subscription_id,
        'payment_intent', p_stripe_payment_intent_id,
        'recorded_at', now()
      )),
      updated_at = now()
  where subscription.organization_id = p_organization_id;
  return true;
end;
$$;

revoke all on function public.settle_werkflow_duplicate_subscription(uuid, text)
  from public, anon, authenticated;
grant execute on function public.settle_werkflow_duplicate_subscription(uuid, text) to service_role;
revoke all on function public.record_werkflow_refund_failure(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_werkflow_refund_failure(uuid, text, text, text) to service_role;
