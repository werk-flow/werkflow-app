-- A refund mails its Stornorechnung to the customer
-- (werk-flow/werkflow-planning#497, epic #245). When a Stripe credit note
-- issues its Storno, and for a partial refund the replacement invoice
-- (20261215100006), the customer organization's billing contact gets one mail
-- with both PDFs, recorded in werkflow_billing_mails under the kind `refund`
-- and the credit note id, so a replayed signal sends nothing twice.
--
-- Three unmerged migrations rewrite the same kind check: 20261215100004
-- (invoice, receipt and debit notice mails and their alarms), 20261215100007
-- (duplicate subscription and failed refund alarms) and this one. Each list
-- holds every kind, so the check is the same whichever of them merges last.
-- The new rule keeps every kind the old ones took.
--
-- Prevention: Tier 1 (the check), Tier 2 supabase/tests/werkflow_billing_mails.sql.

-- @destructive: after release 55088f06: the deployed build never writes werkflow_billing_mails, and the new rule keeps every kind the old one took
alter table public.werkflow_billing_mails drop constraint werkflow_billing_mails_kind_check;

-- @destructive: after release 55088f06: the deployed build writes no werkflow_billing_mails row, and the rule takes every kind the old one took
alter table public.werkflow_billing_mails add constraint werkflow_billing_mails_kind_check check (kind in (
  'payment_failed', 'card_problem', 'mandate_inactive', 'debit_notice', 'invoice', 'receipt', 'refund',
  'alarm.debit_failed', 'alarm.debit_reversed', 'alarm.mandate_inactive',
  'alarm.mail_failed', 'alarm.invoice_check_failed', 'alarm.invoice_undelivered',
  'alarm.debit_notice_late', 'alarm.mail_undelivered', 'alarm.signals_quiet',
  'alarm.reconciliation_missed', 'alarm.duplicate_subscription_cancelled', 'alarm.refund_failed'
)) not valid;
