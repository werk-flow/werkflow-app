-- Resend's delivery signals reach WerkFlow (werk-flow/werkflow-planning#496,
-- epic #245; route agreed with E2c on werk-flow/werkflow-planning#17).
-- app/api/resend/webhook/route.ts verifies a signal's Svix signature, hands it
-- to the ledger that owns its provider message id, and records it here once.
--
-- 1. resend_webhook_events keeps one row per Svix message id, written after
--    the owning ledger's change committed, so a replay finds its row and
--    dispatches nothing. A row holds the Svix id, the provider message id, the
--    event type, Resend's event time and the owning ledger (null for a message
--    no ledger knows): no recipient, subject or body. It belongs to no
--    organization.
-- 2. werkflow_billing_mails records a bounce or a complaint on a sent row,
--    once: the first signal stays. The state stays `sent` (the provider
--    accepted the mail), so no resend goes to the same address by itself.
-- 3. The alarm kind `alarm.mail_bounced` joins the mail kinds.
--
-- No client role reaches the table or the functions. The service role reads
-- both tables and writes only through the two functions.
--
-- Prevention: Tier 1 (grants, RLS, the checks), Tier 2
-- supabase/tests/resend_webhook_events.sql.

create table public.resend_webhook_events (
  svix_id text primary key check (svix_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  event_type text not null check (event_type ~ '^[a-z0-9_.]{1,64}$'),
  provider_message_id text check (provider_message_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  occurred_at timestamptz not null,
  ledger text check (ledger in ('werkflow_billing_mails')),
  received_at timestamptz not null default now(),
  check (ledger is null or provider_message_id is not null)
);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.resend_webhook_events enable row level security;

revoke all on table public.resend_webhook_events from public, anon, authenticated, service_role;
grant select on table public.resend_webhook_events to service_role;

-- Records a handled signal once; a second call for the same Svix id changes
-- nothing and answers false.
create or replace function public.record_resend_webhook_event(
  p_svix_id text,
  p_event_type text,
  p_provider_message_id text,
  p_occurred_at timestamptz,
  p_ledger text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.resend_webhook_events (svix_id, event_type, provider_message_id, occurred_at, ledger)
  values (p_svix_id, p_event_type, p_provider_message_id, p_occurred_at, p_ledger)
  on conflict (svix_id) do nothing;
  return found;
end;
$$;

alter table public.werkflow_billing_mails
  add column delivery_problem text,
  add column delivery_problem_at timestamptz;

-- @destructive: after release 55088f06f: the deployed build never writes werkflow_billing_mails, and the check holds on every row whose new columns are null, as an older build leaves them
alter table public.werkflow_billing_mails
  add constraint werkflow_billing_mails_delivery_problem_check
  check (delivery_problem in ('bounced', 'complained')) not valid;

-- @destructive: after release 55088f06f: the deployed build never writes werkflow_billing_mails, and the check holds on every row whose new columns are null, as an older build leaves them
alter table public.werkflow_billing_mails
  add constraint werkflow_billing_mails_delivery_problem_sent_check
  check (
    (delivery_problem is null) = (delivery_problem_at is null)
    and (delivery_problem is null or provider_message_id is not null)
  ) not valid;

-- @destructive: after release 55088f06f: the deployed build never writes werkflow_billing_mails, and the new rule keeps every kind the old one took
alter table public.werkflow_billing_mails drop constraint werkflow_billing_mails_kind_check;

-- @destructive: after release 55088f06f: the deployed build writes no werkflow_billing_mails row, and the rule takes every kind the old one took
alter table public.werkflow_billing_mails add constraint werkflow_billing_mails_kind_check check (kind in (
  'payment_failed', 'card_problem', 'mandate_inactive',
  'alarm.debit_failed', 'alarm.debit_reversed', 'alarm.mandate_inactive',
  'alarm.mail_failed', 'alarm.invoice_check_failed', 'alarm.mail_bounced'
)) not valid;

-- A local or CI outbox numbers its messages per process, so the index is not unique.
create index werkflow_billing_mails_provider_message_idx
  on public.werkflow_billing_mails (provider_message_id)
  where provider_message_id is not null;

-- Records Resend's bounce or complaint on every sent mail with this provider
-- message id, unless one was recorded before, and answers those rows with the
-- problem each one keeps. No row answers for a message this ledger never sent.
create or replace function public.mark_werkflow_billing_mail_undelivered(
  p_provider_message_id text,
  p_problem text
)
returns table (kind text, organization_id uuid, stripe_object_id text, delivery_problem text)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_problem is null or p_problem not in ('bounced', 'complained') then
    raise exception 'unknown delivery problem' using errcode = '22023';
  end if;

  update public.werkflow_billing_mails mail
  set delivery_problem = p_problem,
      delivery_problem_at = now(),
      updated_at = now()
  where mail.provider_message_id = p_provider_message_id
    and mail.delivery_problem is null;

  return query
  select mail.kind, mail.organization_id, mail.stripe_object_id, mail.delivery_problem
  from public.werkflow_billing_mails mail
  where mail.provider_message_id = p_provider_message_id
  order by mail.created_at, mail.id;
end;
$$;

revoke all on function public.record_resend_webhook_event(text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.mark_werkflow_billing_mail_undelivered(text, text) from public, anon, authenticated;
grant execute on function public.record_resend_webhook_event(text, text, text, timestamptz, text) to service_role;
grant execute on function public.mark_werkflow_billing_mail_undelivered(text, text) to service_role;
