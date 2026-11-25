-- WerkFlow's invoice, receipt and debit notice mails, and the daily comparison
-- with Stripe (werk-flow/werkflow-planning#492, epic #245).
--
-- 1. werkflow_billing_mails takes three customer mails (the debit notice
--    before a renewal, the invoice with its original, the receipt) and five
--    alarms (an invoice without its original or mail, a debit notice with too
--    little lead time, a mail still undelivered, Stripe signals gone quiet,
--    a comparison that did not run). The new rule keeps every existing kind.
--    A debit notice whose renewal has passed is never due again: after its
--    alarm, the comparison ends it as `expired`, so it leaves the failed
--    rows it resends each day.
-- 2. werkflow_billing_reconciliations records each run of the daily
--    comparison, so the next run sees a missed one. No client role reaches
--    it; the service role reads it and adds a row per run.
--
-- Prevention: Tier 1 (the check, grants and RLS), Tier 2
-- supabase/tests/werkflow_billing_reconciliations.sql.

-- @destructive: after release 55088f06f04b: the deployed build never writes werkflow_billing_mails, and the new rule keeps every kind the old one took
alter table public.werkflow_billing_mails drop constraint werkflow_billing_mails_kind_check;

-- @destructive: after release 55088f06f04b: the deployed build writes no werkflow_billing_mails row, and the rule takes every kind the old one took
alter table public.werkflow_billing_mails add constraint werkflow_billing_mails_kind_check check (kind in (
  'payment_failed', 'card_problem', 'mandate_inactive', 'debit_notice', 'invoice', 'receipt',
  'alarm.debit_failed', 'alarm.debit_reversed', 'alarm.mandate_inactive',
  'alarm.mail_failed', 'alarm.invoice_check_failed', 'alarm.invoice_undelivered',
  'alarm.debit_notice_late', 'alarm.mail_undelivered', 'alarm.signals_quiet',
  'alarm.reconciliation_missed', 'alarm.mail_bounced'
)) not valid;

-- @destructive: after release 55088f06f04b: the deployed build never writes werkflow_billing_mails, and the new rule keeps every state the old one took
alter table public.werkflow_billing_mails drop constraint werkflow_billing_mails_state_check;

-- @destructive: after release 55088f06f04b: the deployed build writes no werkflow_billing_mails row, and the rule takes every state the old one took
alter table public.werkflow_billing_mails add constraint werkflow_billing_mails_state_check
  check (state in ('pending', 'sent', 'failed', 'expired')) not valid;

-- Ends a failed debit notice whose renewal has passed. The row keeps no
-- failure code (the check ties one to `failed`); the comparison's
-- `mail_undelivered` alarm carried it. Any other row, or one of another
-- organization, answers false.
create or replace function public.expire_werkflow_billing_mail(p_mail_id uuid, p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.werkflow_billing_mails mail
  set state = 'expired',
      failure_code = null,
      updated_at = now()
  where mail.id = p_mail_id
    and mail.organization_id = p_organization_id
    and mail.kind = 'debit_notice'
    and mail.state = 'failed';

  return found;
end;
$$;

revoke all on function public.expire_werkflow_billing_mail(uuid, uuid) from public, anon, authenticated;
grant execute on function public.expire_werkflow_billing_mail(uuid, uuid) to service_role;

-- The comparison resends the failed rows longest without an attempt first.
create index werkflow_billing_mails_failed_idx
  on public.werkflow_billing_mails (updated_at, id)
  where state = 'failed';

create table public.werkflow_billing_reconciliations (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  invoices_compared integer not null check (invoices_compared >= 0),
  mails_resent integer not null check (mails_resent >= 0),
  alarms_raised integer not null check (alarms_raised >= 0),
  -- False when a Stripe read, a database read or an alarm failed during the run.
  complete boolean not null
);

create index werkflow_billing_reconciliations_ran_at_idx
  on public.werkflow_billing_reconciliations (ran_at desc);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.werkflow_billing_reconciliations enable row level security;

revoke all on table public.werkflow_billing_reconciliations from public, anon, authenticated, service_role;
grant select, insert on table public.werkflow_billing_reconciliations to service_role;
