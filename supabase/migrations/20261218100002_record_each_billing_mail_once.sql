-- WerkFlow's own billing mails and alarms (werk-flow/werkflow-planning#251,
-- epic #245). One row per kind and Stripe object: a mail to a customer
-- organization's billing contact (payment failed, card problem, mandate
-- inactive), or an alarm to WerkFlow's alarm address, which belongs to no
-- organization. A signal handler claims the row, sends through
-- lib/delivery/send-email.ts with the row id as the idempotency key, and
-- settles it: sent with the provider's message id, or failed with a stable
-- code. A sent row never changes, so a replayed signal or Stripe's next
-- delivery sends no second mail; a failed row is sent again on the next claim.
--
-- No client role reaches the table or the functions. The service role reads
-- the table and writes it only through the two functions; the billing page
-- (werk-flow/werkflow-planning#252) reads an organization's mail rows on the
-- server for its Admin. An organization's deletion removes its mail rows.
--
-- Prevention: Tier 1 (grants, checks, the unique key), Tier 2
-- supabase/tests/werkflow_billing_mails.sql.

create table public.werkflow_billing_mails (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'payment_failed', 'card_problem', 'mandate_inactive',
    'alarm.debit_failed', 'alarm.debit_reversed', 'alarm.mandate_inactive',
    'alarm.mail_failed', 'alarm.invoice_check_failed'
  )),
  organization_id uuid references public.organizations (id) on delete cascade,
  recipient text not null check (recipient ~ '^[^@\s]{1,64}@[^@\s]{1,255}$'),
  stripe_object_id text not null check (stripe_object_id ~ '^[A-Za-z0-9_]{1,255}$'),
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text check (provider_message_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  failure_code text check (failure_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (kind, stripe_object_id),
  check ((kind like 'alarm.%') = (organization_id is null)),
  check ((state = 'sent') = (provider_message_id is not null and sent_at is not null)),
  check ((state = 'failed') = (failure_code is not null))
);

create index werkflow_billing_mails_organization_idx
  on public.werkflow_billing_mails (organization_id, created_at desc)
  where organization_id is not null;

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.werkflow_billing_mails enable row level security;

revoke all on table public.werkflow_billing_mails from public, anon, authenticated, service_role;
grant select on table public.werkflow_billing_mails to service_role;

-- Records the mail on its first claim and answers its id, or null when it was
-- sent before: the caller then sends nothing. Otherwise the caller sends with
-- the id as idempotency key and settles; the claim counts the attempt and keeps
-- the newest recipient. A customer mail names its organization, an alarm none.
create or replace function public.claim_werkflow_billing_mail(
  p_kind text,
  p_organization_id uuid,
  p_recipient text,
  p_stripe_object_id text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_state text;
begin
  if (p_kind like 'alarm.%') = (p_organization_id is not null) then
    raise exception 'a customer mail names its organization, an alarm none' using errcode = '22023';
  end if;

  insert into public.werkflow_billing_mails as mail (kind, organization_id, recipient, stripe_object_id, attempts)
  values (p_kind, p_organization_id, p_recipient, p_stripe_object_id, 1)
  on conflict (kind, stripe_object_id) do update
    set attempts = mail.attempts + 1,
        recipient = excluded.recipient,
        updated_at = now()
    where mail.state <> 'sent'
      and mail.organization_id is not distinct from excluded.organization_id;

  select mail.id, mail.state into v_id, v_state
  from public.werkflow_billing_mails mail
  where mail.kind = p_kind
    and mail.stripe_object_id = p_stripe_object_id
    and mail.organization_id is not distinct from p_organization_id;

  if v_id is null then
    raise exception 'the mail belongs to another organization' using errcode = '22023';
  end if;
  return case when v_state = 'sent' then null else v_id end;
end;
$$;

-- Ends one attempt: 'sent' with the provider's message id for good, or
-- 'failed' with a stable code. A sent row never changes and answers false.
create or replace function public.settle_werkflow_billing_mail(
  p_mail_id uuid,
  p_organization_id uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_outcome is null or p_outcome not in ('sent', 'failed')
    or (p_outcome = 'sent') is distinct from (p_provider_message_id is not null)
    or (p_outcome = 'failed') is distinct from (p_failure_code is not null) then
    raise exception 'a sent mail names its message id, a failed one its code' using errcode = '22023';
  end if;

  update public.werkflow_billing_mails mail
  set state = p_outcome,
      provider_message_id = p_provider_message_id,
      failure_code = p_failure_code,
      sent_at = case when p_outcome = 'sent' then now() end,
      updated_at = now()
  where mail.id = p_mail_id
    and mail.organization_id is not distinct from p_organization_id
    and mail.state <> 'sent';

  return found;
end;
$$;

revoke all on function public.claim_werkflow_billing_mail(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.settle_werkflow_billing_mail(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_werkflow_billing_mail(text, uuid, text, text) to service_role;
grant execute on function public.settle_werkflow_billing_mail(uuid, uuid, text, text, text) to service_role;
