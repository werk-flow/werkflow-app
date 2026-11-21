-- The invoice mails and the daily comparison
-- (20261221100004_mail_werkflow_invoices_and_compare_daily.sql,
-- werk-flow/werkflow-planning#492): the mail ledger takes the debit notice,
-- the invoice, the receipt and the five new alarms, and still refuses an
-- unknown kind; only a failed debit notice can end as `expired`; no client
-- role reads or writes the comparison's runs or ends a mail, and the service
-- role only reads the runs and adds one. Recording a resend attempt moves only
-- a failed row of its own organization to the back of the resend order
-- (20261221100005_retry_every_failed_billing_mail_in_turn.sql,
-- werk-flow/werkflow-planning#498).
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1a20000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'billing-run-admin@example.test', '', now(),
  '{}', '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()
);
insert into public.organizations (id, name, admin_id, unique_code)
values ('b1a20000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
  'b1a20000-0000-4000-8000-000000000001', 'BILRUN');

do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(api_role, 'public.werkflow_billing_reconciliations',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '% holds a privilege on werkflow_billing_reconciliations', api_role;
    end if;
    if has_function_privilege(api_role, 'public.expire_werkflow_billing_mail(uuid, uuid)', 'execute') then
      raise exception '% may end a billing mail', api_role;
    end if;
    if has_function_privilege(api_role, 'public.record_werkflow_billing_mail_attempt(uuid, uuid)', 'execute') then
      raise exception '% may move a billing mail in the resend order', api_role;
    end if;
  end loop;
  -- A list of privileges is true when any one is held, so each required one is checked alone.
  if has_table_privilege('service_role', 'public.werkflow_billing_reconciliations', 'UPDATE,DELETE,TRUNCATE') then
    raise exception 'service_role must never change or delete comparison runs';
  end if;
  if not has_table_privilege('service_role', 'public.werkflow_billing_reconciliations', 'SELECT') then
    raise exception 'service_role must read comparison runs';
  end if;
  if not has_table_privilege('service_role', 'public.werkflow_billing_reconciliations', 'INSERT') then
    raise exception 'service_role must add comparison runs';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.werkflow_billing_reconciliations'::regclass)
    or exists (select 1 from pg_policy where polrelid = 'public.werkflow_billing_reconciliations'::regclass) then
    raise exception 'werkflow_billing_reconciliations needs RLS without a client policy';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  v_org constant uuid := 'b1a20000-0000-4000-8000-000000000010';
  v_kind text;
  v_notice uuid;
  v_invoice uuid;
  v_state text;
  v_code text;
begin
  foreach v_kind in array array['debit_notice', 'invoice', 'receipt'] loop
    if public.claim_werkflow_billing_mail(v_kind, v_org, 'rechnung@sonnenberg.example', 'in_test_run_0001') is null then
      raise exception 'the % mail was not claimed', v_kind;
    end if;
  end loop;
  foreach v_kind in array array['alarm.invoice_undelivered', 'alarm.debit_notice_late', 'alarm.mail_undelivered',
      'alarm.signals_quiet', 'alarm.reconciliation_missed'] loop
    if public.claim_werkflow_billing_mail(v_kind, null, 'alarm@example.test', 'in_test_run_0001') is null then
      raise exception 'the % alarm was not claimed', v_kind;
    end if;
  end loop;
  begin
    perform public.claim_werkflow_billing_mail('refund', v_org, 'rechnung@sonnenberg.example', 'in_test_run_0002');
    raise exception 'an unknown mail kind was claimed';
  exception when check_violation then null;
  end;

  -- A failed debit notice ends as `expired` once, only for its organization; a failed mail of another kind, or a sent notice, never.
  v_notice := public.claim_werkflow_billing_mail('debit_notice', v_org, 'rechnung@sonnenberg.example', 'sub_test_run_0003');
  v_invoice := public.claim_werkflow_billing_mail('invoice', v_org, 'rechnung@sonnenberg.example', 'in_test_run_0003');
  perform public.settle_werkflow_billing_mail(v_notice, v_org, 'failed', null, 'email_daily_quota_exceeded');
  perform public.settle_werkflow_billing_mail(v_invoice, v_org, 'failed', null, 'email_daily_quota_exceeded');
  if public.expire_werkflow_billing_mail(v_notice, gen_random_uuid()) then
    raise exception 'a debit notice ended for another organization';
  end if;
  if not public.expire_werkflow_billing_mail(v_notice, v_org) then
    raise exception 'a failed debit notice did not end';
  end if;
  select state, failure_code into v_state, v_code from public.werkflow_billing_mails where id = v_notice;
  if v_state is distinct from 'expired' or v_code is not null then
    raise exception 'an ended debit notice is %, code %', v_state, v_code;
  end if;
  if public.expire_werkflow_billing_mail(v_notice, v_org) then
    raise exception 'an expired debit notice ended again';
  end if;
  if public.expire_werkflow_billing_mail(v_invoice, v_org) then
    raise exception 'a failed invoice mail ended as expired';
  end if;
  if not exists (select 1 from public.werkflow_billing_mails where id = v_invoice and state = 'failed') then
    raise exception 'the failed invoice mail changed';
  end if;
  v_notice := public.claim_werkflow_billing_mail('debit_notice', v_org, 'rechnung@sonnenberg.example', 'sub_test_run_0004');
  perform public.settle_werkflow_billing_mail(v_notice, v_org, 'sent', 're_test_run_0004', null);
  if public.expire_werkflow_billing_mail(v_notice, v_org) then
    raise exception 'a sent debit notice ended as expired';
  end if;

  insert into public.werkflow_billing_reconciliations (invoices_compared, mails_resent, alarms_raised, complete)
  values (3, 1, 2, true);
  begin
    update public.werkflow_billing_reconciliations set complete = false;
    raise exception 'service_role changed a recorded run';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Rows that failed a month ago, as the comparison finds them.
insert into public.werkflow_billing_mails (id, kind, organization_id, recipient, stripe_object_id, state, failure_code, updated_at)
values
  ('b1a20000-0000-4000-8000-000000000021', 'payment_failed', 'b1a20000-0000-4000-8000-000000000010',
    'rechnung@sonnenberg.example', 'in_test_run_0021', 'failed', 'stripe_read_failed', now() - interval '30 days'),
  ('b1a20000-0000-4000-8000-000000000022', 'alarm.debit_failed', null,
    'alarm@example.test', 'in_test_run_0022', 'failed', 'email_daily_quota_exceeded', now() - interval '30 days');
insert into public.werkflow_billing_mails (id, kind, organization_id, recipient, stripe_object_id, state,
  provider_message_id, sent_at, updated_at)
values ('b1a20000-0000-4000-8000-000000000023', 'receipt', 'b1a20000-0000-4000-8000-000000000010',
  'rechnung@sonnenberg.example', 'in_test_run_0023', 'sent', 're_test_run_0023', now() - interval '30 days',
  now() - interval '30 days');

set local role service_role;
do $$
declare
  v_org constant uuid := 'b1a20000-0000-4000-8000-000000000010';
  v_mail constant uuid := 'b1a20000-0000-4000-8000-000000000021';
  v_alarm constant uuid := 'b1a20000-0000-4000-8000-000000000022';
  v_sent constant uuid := 'b1a20000-0000-4000-8000-000000000023';
begin
  if public.record_werkflow_billing_mail_attempt(v_mail, gen_random_uuid()) then
    raise exception 'an attempt was recorded for another organization';
  end if;
  if public.record_werkflow_billing_mail_attempt(v_mail, null) then
    raise exception 'a customer mail attempt was recorded without its organization';
  end if;
  if not exists (select 1 from public.werkflow_billing_mails where id = v_mail and updated_at < now() - interval '1 day') then
    raise exception 'a refused attempt moved the mail';
  end if;
  if not public.record_werkflow_billing_mail_attempt(v_mail, v_org)
    or not public.record_werkflow_billing_mail_attempt(v_alarm, null) then
    raise exception 'a failed mail attempt was not recorded';
  end if;
  if exists (select 1 from public.werkflow_billing_mails
      where id in (v_mail, v_alarm) and (updated_at <> now() or state <> 'failed' or attempts <> 0)) then
    raise exception 'a recorded attempt did not move only the failed row to the back';
  end if;
  if public.record_werkflow_billing_mail_attempt(v_sent, v_org) then
    raise exception 'an attempt was recorded for a sent mail';
  end if;
  if not exists (select 1 from public.werkflow_billing_mails where id = v_sent and updated_at < now() - interval '1 day') then
    raise exception 'a sent mail moved';
  end if;
end;
$$;
reset role;

rollback;
