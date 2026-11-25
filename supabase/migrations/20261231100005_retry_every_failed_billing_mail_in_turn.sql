-- Every failed billing mail gets its turn in the daily comparison
-- (werk-flow/werkflow-planning#498, epic #245). The comparison resends the
-- failed rows of werkflow_billing_mails longest without an attempt first, in
-- batches. Only the claim moved a row back, so a resend that failed before
-- its claim (a Stripe read, a missing original) kept the row in front, and
-- enough such rows held back every newer failed mail for good. The comparison
-- now records each attempt before it resends: the row moves behind every row
-- not yet tried, whether or not the resend reaches its claim, so each failed
-- row is tried within the runs its backlog needs.
--
-- Prevention: Tier 2 supabase/tests/werkflow_billing_reconciliations.sql and
-- lib/testing/fixtures/billing-invoice-mails.ts.

-- Moves one failed mail to the back of the resend order and answers true. A
-- row that is no longer failed, or one of another organization, answers false
-- and is not resent. The claim still counts the attempt.
create or replace function public.record_werkflow_billing_mail_attempt(p_mail_id uuid, p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.werkflow_billing_mails mail
  set updated_at = now()
  where mail.id = p_mail_id
    and mail.organization_id is not distinct from p_organization_id
    and mail.state = 'failed';

  return found;
end;
$$;

revoke all on function public.record_werkflow_billing_mail_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_werkflow_billing_mail_attempt(uuid, uuid) to service_role;
